/**
 * Run journeys or capacity checks against isolated, disposable local Workers.
 *
 * Journeys: the control plane on one port with the relay behind it (one
 * Miniflare, cross-script SessionDO + RELAY service binding, as deployed), and
 * a second, relay-only runtime on its own port for the self-hosted journeys.
 * Capacity: the relay alone, the plane that carries the live load.
 */
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
const relayDir = resolve(root, 'apps/relay');
const capacity = process.argv[2] === '--capacity';
if (capacity && process.argv.length !== 3) throw new Error('Usage: bun run verify:capacity');
const label = capacity ? 'Capacity check' : 'Browser journeys';
const output = resolve(root, 'e2e/verification-output', capacity ? 'capacity' : '.');
await mkdir(output, { recursive: true });
if (capacity) await rm(resolve(output, 'metrics.json'), { force: true });
const temporary = await mkdtemp(resolve(tmpdir(), 'openroom-verification-'));
process.once('exit', () => rmSync(temporary, { recursive: true, force: true }));
const persist = resolve(temporary, 'state');
const relayOnlyPersist = resolve(temporary, 'relay-only-state');
const tokenSecret = 'isolated-local-verification-only';
const relayKey = 'dev-relay';
const relayName = 'openroom-relay-verification';

/** A disposable copy of a Worker's wrangler.jsonc: no routes, no account, local vars only. */
async function disposableConfig(dir, name, edit) {
  const errors = [];
  const config = parse(await readFile(resolve(dir, 'wrangler.jsonc'), 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== 'object') throw new Error(`Cannot parse ${dir}/wrangler.jsonc`);
  config.name = name;
  config.main = resolve(dir, config.main);
  config.assets.directory = resolve(dir, config.assets.directory);
  config.workers_dev = false;
  for (const field of ['$schema', 'routes', 'env', 'triggers', 'observability', 'account_id']) delete config[field];
  edit(config);
  const configFile = resolve(temporary, `${name}.json`);
  await writeFile(configFile, JSON.stringify(config));
  return { config, configFile, bundleDir: resolve(temporary, `${name}-bundle`) };
}

const relay = await disposableConfig(relayDir, relayName, (config) => {
  if (capacity) config.main = resolve(root, 'scripts/capacity-worker.mjs');
  config.vars = { TOKEN_SECRET: tokenSecret, RELAY_KEY: relayKey, JOIN_ORIGIN: '' };
});
const control = capacity ? null : await disposableConfig(workerDir, 'openroom-verification', (config) => {
  config.vars = { TOKEN_SECRET: tokenSecret, ADMIN_KEY: 'dev-admin', DEMO_AUTH: '1', JOIN_ORIGIN: '' };
  for (const binding of config.durable_objects?.bindings ?? []) if (binding.script_name) binding.script_name = relayName;
  for (const service of config.services ?? []) service.service = relayName;
  for (const database of config.d1_databases ?? []) {
    database.migrations_dir = resolve(workerDir, database.migrations_dir ?? 'migrations');
    delete database.remote;
  }
  for (const bucket of config.r2_buckets ?? []) delete bucket.remote;
});

const freePort = () => new Promise((accept, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => accept(port)); });
});
const port = await freePort();
const relayPort = capacity ? null : await freePort();
const origin = `http://127.0.0.1:${port}`;
const relayOrigin = relayPort === null ? origin : `http://127.0.0.1:${relayPort}`;
const env = {
  ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', OPENROOM_URL: origin, OPENROOM_JOIN_URL: `${origin}/join`,
  OPENROOM_ADMIN_KEY: 'dev-admin', OPENROOM_E2E_TOKEN_SECRET: tokenSecret, OPENROOM_E2E_PERSIST_TO: persist,
  OPENROOM_RELAY_URL: relayOrigin, OPENROOM_RELAY_KEY: relayKey,
};
const evidence = { startedAt: new Date().toISOString(), kind: capacity ? 'capacity' : 'browser', runtime: 'direct-miniflare', target: capacity ? 'relay' : 'control-plane+relay', localOnly: true, providerCallsVerified: false, nativeOfficeVerified: false, desktopEnabled: !capacity && env.RUN_DESKTOP_JOURNEY === '1' };
await writeFile(resolve(output, 'run.json'), JSON.stringify({ ...evidence, status: 'running', succeeded: false }, null, 2));
const log = createWriteStream(resolve(output, 'worker.log'), { flags: 'w' });
const runtimes = [];
let journeys;
let succeeded = false;

const bundleFile = (target) => resolve(target.bundleDir, `${basename(target.config.main, extname(target.config.main))}.js`);
async function bundle(target, cwd) {
  await run(bun, ['x', 'wrangler', 'deploy', '--dry-run', '--config', target.configFile, '--outdir', target.bundleDir], { cwd, env });
}
function serve(statePath, listenPort, targets, name) {
  const args = [resolve(workerDir, 'scripts/verification-runtime.mjs'), statePath, String(listenPort)];
  for (const target of targets) args.push(target.configFile, bundleFile(target));
  const child = start(process.execPath, args, { cwd: workerDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  runtimes.push({ child, name });
  return child;
}
async function healthy(child, url) {
  const deadline = Date.now() + 60_000;
  while (true) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Local Worker exited; see ${output}/worker.log`);
    try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Starting. */ }
    if (Date.now() > deadline) throw new Error(`Local Worker did not become healthy at ${url}; see ${output}/worker.log`);
    await new Promise((accept) => setTimeout(accept, 200));
  }
}

try {
  await bundle(relay, relayDir);
  if (control) {
    await run(bun, ['x', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', control.configFile, '--persist-to', persist], { cwd: workerDir, env });
    await bundle(control, workerDir);
    await healthy(serve(persist, port, [control, relay], 'control plane + relay'), origin);
    await healthy(serve(relayOnlyPersist, relayPort, [relay], 'relay only'), relayOrigin);
    console.log(`${label}: control plane ready at ${origin}, relay-only at ${relayOrigin}; storage is disposable.`);
  } else {
    await healthy(serve(persist, port, [relay], 'relay'), origin);
    console.log(`${label}: relay ready at ${origin}; storage is disposable.`);
  }
  journeys = capacity
    ? start(process.execPath, [resolve(root, 'scripts/capacity-clients.mjs')], { cwd: root, env })
    : start(bun, ['x', 'playwright', 'test', ...process.argv.slice(2)], { cwd: resolve(root, 'e2e'), env });
  await Promise.race([
    completed(journeys, label),
    ...runtimes.map(({ child, name }) => new Promise((_, reject) => child.once('close', (code, signal) => reject(new Error(`Local Worker (${name}) exited during ${label.toLowerCase()} (${signal ?? code}); see ${output}/worker.log`))))),
  ]);
  succeeded = true;
} finally {
  if (journeys) await stop(journeys);
  for (const { child } of runtimes) await stop(child);
  if (capacity) {
    const metricsFile = resolve(output, 'metrics.json');
    const metrics = await readFile(metricsFile, 'utf8').then(JSON.parse).catch(() => null);
    if (metrics?.status === 'running' || (!succeeded && metrics?.status === 'passed')) {
      await writeFile(metricsFile, JSON.stringify({ ...metrics, status: 'interrupted', finishedAt: new Date().toISOString(), error: 'The local relay or capacity client exited before verification completed; see run.json and worker.log.' }, null, 2));
    }
  }
  await new Promise((accept) => log.end(accept));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(resolve(output, 'run.json'), JSON.stringify({ ...evidence, status: succeeded ? 'passed' : 'failed', finishedAt: new Date().toISOString(), succeeded }, null, 2));
}
