/** Trusted localhost Office development, with isolated, persistent local data. */
import { randomBytes, X509Certificate } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { bun, completed, run, start, stop } from './ci/run.mjs';
import { installManifests, showHelperGrant } from './office-addin.mjs';

const options = process.argv.slice(2);
if (options.some((option) => !['--install', '--skip-build'].includes(option))) {
  throw new Error('Usage: bun run dev:office [--install] [--skip-build]');
}
const install = options.includes('--install');
if (install && process.platform !== 'darwin') throw new Error('Automatic sideloading currently supports macOS. See apps/office/README.md.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = resolve(root, 'apps/workspace-worker');
const relayDir = resolve(root, 'apps/relay');
const local = resolve(root, '.wrangler/office');
const persist = resolve(local, 'state');
const origin = 'https://localhost:3443';
const certificates = resolve(homedir(), '.office-addin-dev-certs');
const certificate = resolve(certificates, 'localhost.crt');
const key = resolve(certificates, 'localhost.key');
if (install) await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'office-addin-dev-certs@3.0.0', 'install'], { cwd: root });
let ca;
try {
  ca = await readFile(resolve(certificates, 'ca.crt'));
  const leaf = new X509Certificate(await readFile(certificate));
  if (Date.parse(leaf.validTo) <= Date.now()) throw new Error('Certificate expired');
  await readFile(key);
} catch {
  throw new Error('Trusted localhost certificates are missing or expired. Run bun run office:install (macOS), or npx office-addin-dev-certs@3.0.0 install.');
}
if (!options.includes('--skip-build')) await run(process.execPath, ['scripts/verify.mjs', '--build-only'], { cwd: root });
await mkdir(local, { recursive: true, mode: 0o700 });
const secretFile = resolve(local, 'local-secrets.json');
try {
  await writeFile(secretFile, JSON.stringify({ TOKEN_SECRET: randomBytes(32).toString('hex'), ADMIN_KEY: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
const secrets = JSON.parse(await readFile(secretFile, 'utf8'));
if (!secrets.RELAY_KEY) {
  secrets.RELAY_KEY = randomBytes(32).toString('hex');
  await writeFile(secretFile, JSON.stringify(secrets), { mode: 0o600 });
}
async function localConfig(dir, name) {
  const errors = [];
  const value = parse(await readFile(resolve(dir, 'wrangler.jsonc'), 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object') throw new Error(`Cannot parse ${dir}/wrangler.jsonc`);
  value.name = name;
  value.main = resolve(dir, value.main);
  value.assets.directory = resolve(dir, value.assets.directory);
  value.workers_dev = false;
  for (const field of ['$schema', 'routes', 'env', 'triggers', 'observability', 'account_id']) delete value[field];
  return value;
}
// Live sessions run in the relay Worker. The control plane reaches it through the
// SessionDO and RELAY bindings, which the local dev registry resolves by script name.
const relayName = 'openroom-office-relay';
const relayConfig = await localConfig(relayDir, relayName);
relayConfig.vars = { TOKEN_SECRET: secrets.TOKEN_SECRET, RELAY_KEY: secrets.RELAY_KEY, JOIN_ORIGIN: '' };
const relayConfigFile = resolve(local, 'relay.json');
await writeFile(relayConfigFile, JSON.stringify(relayConfig), { mode: 0o600 });
await chmod(relayConfigFile, 0o600);
const config = await localConfig(workerDir, 'openroom-office-local');
config.vars = { TOKEN_SECRET: secrets.TOKEN_SECRET, ADMIN_KEY: secrets.ADMIN_KEY, DEMO_AUTH: '1', JOIN_ORIGIN: '' };
for (const binding of config.durable_objects?.bindings ?? []) if (binding.script_name) binding.script_name = relayName;
for (const service of config.services ?? []) service.service = relayName;
for (const database of config.d1_databases ?? []) {
  database.migrations_dir = resolve(workerDir, database.migrations_dir ?? 'migrations');
  delete database.remote;
}
for (const bucket of config.r2_buckets ?? []) delete bucket.remote;
const configFile = resolve(local, 'wrangler.json');
await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
await chmod(configFile, 0o600);
const env = {
  ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
};
function readLocal(path) {
  return new Promise((accept, reject) => {
    const request = get(`${origin}${path}`, { ca, family: 4, timeout: 3000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`${path}: HTTP ${response.statusCode}`)); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part) => { body += part; });
      response.on('end', () => accept(body));
      response.on('error', reject);
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Local HTTPS request timed out')));
  });
}
const freePort = () => new Promise((accept, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => accept(port)); });
});
const relayHealthy = (port) => new Promise((accept, reject) => {
  const request = httpGet({ host: '127.0.0.1', port, path: '/api/health', timeout: 3000 }, (response) => {
    response.resume();
    if (response.statusCode === 200) accept(); else reject(new Error(`relay health: HTTP ${response.statusCode}`));
  });
  request.once('error', reject);
  request.once('timeout', () => request.destroy(new Error('Local relay request timed out')));
});
// CI=1 applies local migrations without the interactive confirmation prompt.
await run(bun, ['x', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configFile, '--persist-to', persist], { cwd: local, env: { ...env, CI: '1' } });
let worker, relay;
try {
  const relayPort = await freePort();
  relay = start(bun, ['x', 'wrangler', 'dev', '--local', '--config', relayConfigFile, '--ip', '127.0.0.1', '--port', String(relayPort), '--persist-to', persist], { cwd: local, env });
  const relayDeadline = Date.now() + 60_000;
  while (true) {
    if (relay.exitCode !== null || relay.signalCode !== null) throw new Error('Local relay exited during startup');
    try { await relayHealthy(relayPort); break; } catch { /* Waiting for the local relay. */ }
    if (Date.now() > relayDeadline) throw new Error('Local relay did not become healthy');
    await new Promise((accept) => setTimeout(accept, 250));
  }
  worker = start(bun, ['x', 'wrangler', 'dev', '--local', '--config', configFile,
    '--ip', '127.0.0.1', '--port', '3443', '--local-protocol', 'https',
    '--https-key-path', key, '--https-cert-path', certificate,
    '--local-upstream', 'localhost:3443', '--upstream-protocol', 'https', '--persist-to', persist,
  ], { cwd: local, env });
  const deadline = Date.now() + 60_000;
  while (true) {
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Local Office server exited during startup');
    try { await readLocal('/api/health'); break; } catch { /* Waiting for local workerd. */ }
    if (Date.now() > deadline) throw new Error('Local Office server did not become healthy over trusted HTTPS');
    await new Promise((accept) => setTimeout(accept, 250));
  }
  const manifests = [
    ['/office/manifest.xml', 'openroom-taskpane.xml', 'a4d615bd-34ea-4d56-a147-460e24624b40'],
    ['/office/content-manifest.xml', 'openroom-display.xml', 'f765119e-b940-4b85-81a7-4b4d855b9d68'],
  ];
  const fallback = resolve(local, 'manifests');
  for (const [path, filename, id] of manifests) {
    const manifest = await readLocal(path);
    if (!manifest.includes(`<Id>${id}</Id>`) || !manifest.includes(`SourceLocation DefaultValue="${origin}/office/`)) {
      throw new Error(`Unexpected origin or identity in ${path}`);
    }
    await mkdir(fallback, { recursive: true });
    await writeFile(resolve(fallback, filename), manifest);
  }
  let installed = false;
  if (install) {
    try { await installManifests(fallback); installed = true; } catch (error) {
      console.warn(`\n${error.message}`);
      if (error.code === 'OPENROOM_INSTALL_REFUSED') console.warn(await showHelperGrant());
    }
  }
  console.log(`\nOpenRoom Office ready at ${origin}. Keep this command running while using the local add-ins.`);
  console.log('Local demo account: alice / demo. Data stays in .wrangler/office/state; no provider or production configuration is loaded.');
  console.log('This loopback server is for this Mac; phones cannot join its sessions.');
  if (installed) console.log('Both manifests installed. Restart PowerPoint, open a presentation, then choose Home > Add-ins > OpenRoom (task pane) or OpenRoom Slide (embedded slide).');
  await completed(worker, 'Local Office server');
} finally {
  if (worker) await stop(worker);
  if (relay) await stop(relay);
}
