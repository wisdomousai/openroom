/** Run journeys or capacity checks against an isolated, disposable local Worker. */
import { createWriteStream, rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { bun, completed, run, start, stop } from './ci/run.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = resolve(root, 'apps/worker');
const capacity = process.argv[2] === '--capacity';
if (capacity && process.argv.length !== 3) throw new Error('Usage: bun run verify:capacity');
const label = capacity ? 'Capacity check' : 'Browser journeys';
const output = resolve(root, 'e2e/verification-output', capacity ? 'capacity' : '.');
await mkdir(output, { recursive: true });
if (capacity) await rm(resolve(output, 'metrics.json'), { force: true });
const source = resolve(workerDir, 'wrangler.jsonc');
const errors = [];
const config = parse(await readFile(source, 'utf8'), errors, { allowTrailingComma: true });
if (errors.length || !config || typeof config !== 'object') throw new Error('Cannot parse Worker configuration');
const temporary = await mkdtemp(resolve(tmpdir(), 'openroom-verification-'));
process.once('exit', () => rmSync(temporary, { recursive: true, force: true }));
const persist = resolve(temporary, 'state');
const configFile = resolve(temporary, 'wrangler.json');
const bundleDir = resolve(temporary, 'bundle');
const tokenSecret = 'isolated-local-verification-only';
config.name = 'openroom-verification';
config.main = capacity ? resolve(root, 'scripts/capacity-worker.mjs') : resolve(workerDir, config.main);
config.assets.directory = resolve(workerDir, config.assets.directory);
config.vars = { TOKEN_SECRET: tokenSecret, ADMIN_KEY: 'dev-admin', DEMO_AUTH: '1', JOIN_ORIGIN: '' };
config.workers_dev = false;
for (const field of ['$schema', 'routes', 'env', 'triggers', 'observability', 'account_id']) delete config[field];
for (const database of config.d1_databases ?? []) {
  database.migrations_dir = resolve(workerDir, database.migrations_dir ?? 'migrations');
  delete database.remote;
}
for (const bucket of config.r2_buckets ?? []) delete bucket.remote;
await writeFile(configFile, JSON.stringify(config));
const port = await new Promise((accept, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => accept(port)); });
});
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', OPENROOM_URL: origin, OPENROOM_JOIN_URL: `${origin}/join`,
  OPENROOM_ADMIN_KEY: 'dev-admin', OPENROOM_E2E_TOKEN_SECRET: tokenSecret, OPENROOM_E2E_PERSIST_TO: persist,
};
const evidence = { startedAt: new Date().toISOString(), kind: capacity ? 'capacity' : 'browser', runtime: 'direct-miniflare', localOnly: true, providerCallsVerified: false, nativeOfficeVerified: false, desktopEnabled: !capacity && env.RUN_DESKTOP_JOURNEY === '1' };
await writeFile(resolve(output, 'run.json'), JSON.stringify({ ...evidence, status: 'running', succeeded: false }, null, 2));
const log = createWriteStream(resolve(output, 'worker.log'), { flags: 'w' });
let worker;
let journeys;
let succeeded = false;
try {
  await run(bun, ['x', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configFile, '--persist-to', persist], { cwd: workerDir, env });
  await run(bun, ['x', 'wrangler', 'deploy', '--dry-run', '--config', configFile, '--outdir', bundleDir], { cwd: workerDir, env });
  const bundleFile = resolve(bundleDir, `${basename(config.main, extname(config.main))}.js`);
  worker = start(process.execPath, [resolve(workerDir, 'scripts/verification-runtime.mjs'), configFile, bundleFile, persist, String(port)], { cwd: workerDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.pipe(log, { end: false }); worker.stderr.pipe(log, { end: false });
  const deadline = Date.now() + 60_000;
  while (true) {
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Local Worker exited; see ${output}/worker.log`);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Starting. */ }
    if (Date.now() > deadline) throw new Error(`Local Worker did not become healthy; see ${output}/worker.log`);
    await new Promise((accept) => setTimeout(accept, 200));
  }
  console.log(`${label}: Worker ready at ${origin}; storage is disposable.`);
  journeys = capacity
    ? start(process.execPath, [resolve(root, 'scripts/capacity-clients.mjs')], { cwd: root, env })
    : start(bun, ['x', 'playwright', 'test', ...process.argv.slice(2)], { cwd: resolve(root, 'e2e'), env });
  await Promise.race([
    completed(journeys, label),
    new Promise((_, reject) => worker.once('close', (code, signal) => reject(new Error(`Local Worker exited during ${label.toLowerCase()} (${signal ?? code}); see ${output}/worker.log`)))),
  ]);
  succeeded = true;
} finally {
  if (journeys) await stop(journeys);
  if (worker) await stop(worker);
  if (capacity) {
    const metricsFile = resolve(output, 'metrics.json');
    const metrics = await readFile(metricsFile, 'utf8').then(JSON.parse).catch(() => null);
    if (metrics?.status === 'running' || (!succeeded && metrics?.status === 'passed')) {
      await writeFile(metricsFile, JSON.stringify({ ...metrics, status: 'interrupted', finishedAt: new Date().toISOString(), error: 'The local Worker or capacity client exited before verification completed; see run.json and worker.log.' }, null, 2));
    }
  }
  await new Promise((accept) => log.end(accept));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(resolve(output, 'run.json'), JSON.stringify({ ...evidence, status: succeeded ? 'passed' : 'failed', finishedAt: new Date().toISOString(), succeeded }, null, 2));
}
