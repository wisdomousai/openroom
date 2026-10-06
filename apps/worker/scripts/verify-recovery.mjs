/** Export, restore and exercise a synthetic installation using two disposable local stores. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';
import { parse } from 'jsonc-parser';
import { bun, run } from '../../../scripts/ci/run.mjs';
import { recoveryPreparation } from '../src/operations/recovery.ts';
import { captureRecoveryBundle, restoreRecoveryMedia, verifyRecoveryBundle } from './recovery-bundle.mjs';
import { seedRecoveryFixture, verifyRecoveredFixture } from './recovery-fixture.mjs';

if (process.argv.length !== 2) throw new Error('Usage: bun run verify:recovery (no external target arguments)');
const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(workerDir, '../..');
const output = resolve(root, 'e2e/verification-output/recovery');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), status: 'running', localOnly: true, runtime: 'direct-miniflare', hostedRecoveryVerified: false };
await writeFile(resolve(output, 'run.json'), JSON.stringify(report, null, 2));
const temporary = await mkdtemp(resolve(tmpdir(), 'openroom-recovery-'));
// Wrangler's local export uses the config-relative default path (no --persist-to option).
const sourceState = resolve(temporary, '.wrangler/state'), targetState = resolve(temporary, 'restored');
const configFile = resolve(temporary, 'wrangler.json'), bundleDir = resolve(temporary, 'worker');
const schemaFile = resolve(temporary, 'schema.sql'), dataFile = resolve(temporary, 'data.sql'), backup = resolve(temporary, 'backup');
Object.assign(process.env, { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' });
const config = parse(await readFile(resolve(workerDir, 'wrangler.jsonc'), 'utf8'));
config.name = 'openroom-recovery';
config.main = resolve(workerDir, config.main);
config.assets.directory = resolve(workerDir, config.assets.directory);
config.vars = { TOKEN_SECRET: 'recovery-source-fixture-only', ADMIN_KEY: 'dev-admin', DEMO_AUTH: '1', JOIN_ORIGIN: '' };
config.workers_dev = false;
for (const field of ['$schema', 'routes', 'env', 'triggers', 'observability', 'account_id']) delete config[field];
for (const database of config.d1_databases) { database.migrations_dir = resolve(workerDir, database.migrations_dir); delete database.remote; }
for (const bucket of config.r2_buckets) delete bucket.remote;
// Live sessions run in the relay; it is bound by script name, as deployed.
const relayDir = resolve(workerDir, '../relay');
const relayConfigFile = resolve(temporary, 'relay.json'), relayBundleDir = resolve(temporary, 'relay');
const relayConfig = parse(await readFile(resolve(relayDir, 'wrangler.jsonc'), 'utf8'));
relayConfig.name = 'openroom-recovery-relay';
relayConfig.main = resolve(relayDir, relayConfig.main);
relayConfig.assets.directory = resolve(relayDir, relayConfig.assets.directory);
relayConfig.workers_dev = false;
for (const field of ['$schema', 'routes', 'env', 'triggers', 'observability', 'account_id']) delete relayConfig[field];
for (const binding of config.durable_objects.bindings) if (binding.script_name) binding.script_name = relayConfig.name;
for (const service of config.services ?? []) service.service = relayConfig.name;
await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
const wrangler = (...args) => run(bun, ['x', 'wrangler', ...args, '--config', configFile], { cwd: workerDir, env: process.env });
let runtime;
async function open(persist) {
  // The relay signs and verifies with the control plane's current TOKEN_SECRET.
  relayConfig.vars = { TOKEN_SECRET: config.vars.TOKEN_SECRET, JOIN_ORIGIN: '' };
  await writeFile(relayConfigFile, JSON.stringify(relayConfig), { mode: 0o600 });
  const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(configFile);
  const relayOptions = unstable_getMiniflareWorkerOptions(relayConfigFile).workerOptions;
  runtime = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, resourcePersistencePath: resolve(persist, 'v3'),
    workers: [
      { ...workerOptions, name: config.name, modules: true, modulesRoot: bundleDir, scriptPath: resolve(bundleDir, 'index.js') },
      { ...relayOptions, name: relayConfig.name, modules: true, modulesRoot: relayBundleDir, scriptPath: resolve(relayBundleDir, 'index.js') },
      ...externalWorkers,
    ] });
  await runtime.ready;
  return runtime;
}
async function close() { if (runtime) { await runtime.dispose(); runtime = undefined; } }
async function fingerprints(db) {
  const { results } = await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name!='d1_migrations' ORDER BY name").all();
  const result = {};
  for (const { name } of results) {
    const rows = await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
    result[name] = { count: rows.results.length, sha256: createHash('sha256').update(JSON.stringify(rows.results.map(row => JSON.stringify(row)).sort())).digest('hex') };
  }
  return result;
}
try {
  await wrangler('d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', sourceState);
  await wrangler('deploy', '--dry-run', '--outdir', bundleDir);
  relayConfig.vars = { TOKEN_SECRET: config.vars.TOKEN_SECRET, JOIN_ORIGIN: '' };
  await writeFile(relayConfigFile, JSON.stringify(relayConfig), { mode: 0o600 });
  await run(bun, ['x', 'wrangler', 'deploy', '--dry-run', '--config', relayConfigFile, '--outdir', relayBundleDir], { cwd: relayDir, env: process.env });
  const capturedAt = Date.now(), recoveredAt = capturedAt + 60_000;
  await open(sourceState);
  const fixture = await seedRecoveryFixture(runtime, capturedAt);
  const original = await fingerprints(await runtime.getD1Database('DB'));
  await close();
  // Export only after all source writers and live objects have stopped.
  await wrangler('d1', 'export', 'DB', '--local', '--no-data', '--output', schemaFile);
  await wrangler('d1', 'export', 'DB', '--local', '--no-schema', '--output', dataFile);
  await open(sourceState);
  const sourceDb = await runtime.getD1Database('DB'), sourceBucket = await runtime.getR2Bucket('MEDIA');
  await sourceBucket.put('archives/unindexed-fixture.json', '{}');
  const incomplete = resolve(temporary, 'incomplete');
  await assert.rejects(() => captureRecoveryBundle(sourceDb, sourceBucket, schemaFile, dataFile, incomplete, capturedAt), /unindexed session captures/);
  await assert.rejects(() => readFile(resolve(incomplete, 'manifest.json')), { code: 'ENOENT' });
  await sourceBucket.delete('archives/unindexed-fixture.json');
  const manifest = await captureRecoveryBundle(await runtime.getD1Database('DB'), await runtime.getR2Bucket('MEDIA'), schemaFile, dataFile, backup, capturedAt);
  await verifyRecoveryBundle(backup);
  await close();
  // Demonstrate corruption detection before any restore is attempted.
  const objectFile = resolve(backup, 'objects', manifest.objects[0].file), originalBytes = await readFile(objectFile);
  await writeFile(objectFile, Buffer.from('corrupt fixture'));
  await assert.rejects(() => verifyRecoveryBundle(backup), /checksum failed/);
  await writeFile(objectFile, originalBytes);
  await verifyRecoveryBundle(backup);
  // Backup retention can delete expired bytes without preventing recovery of retained data.
  const expired = manifest.objects.find(item => item.retainedUntil !== null && item.retainedUntil <= recoveredAt);
  assert(expired);
  await rm(resolve(backup, 'objects', expired.file));
  await verifyRecoveryBundle(backup, recoveredAt);
  config.vars.TOKEN_SECRET = 'recovery-target-fixture-only';
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  // The target has no schema or source live-object state. No migration is applied first.
  await wrangler('d1', 'execute', 'DB', '--local', '--persist-to', targetState, '--file', resolve(backup, 'schema.sql'));
  await wrangler('d1', 'execute', 'DB', '--local', '--persist-to', targetState, '--file', resolve(backup, 'data.sql'));
  await open(targetState);
  const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('MEDIA');
  assert.deepEqual(await fingerprints(db), original, 'Every application table must survive export/import exactly');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(Object.values((await db.prepare('PRAGMA quick_check').first()))[0], 'ok');
  await bucket.put('wrong-target-marker', 'leave this alone');
  await assert.rejects(() => restoreRecoveryMedia(bucket, backup, recoveredAt), /must be empty/);
  assert.equal(await (await bucket.get('wrong-target-marker')).text(), 'leave this alone');
  await bucket.delete('wrong-target-marker');
  let racedKey;
  const racingBucket = { list: options => bucket.list(options), get: key => bucket.get(key), put: async (key, bytes, options) => {
    racedKey = key; await bucket.put(key, 'concurrent-writer'); return bucket.put(key, bytes, options);
  } };
  await assert.rejects(() => restoreRecoveryMedia(racingBucket, backup, recoveredAt), /target changed/);
  assert.equal(await (await bucket.get(racedKey)).text(), 'concurrent-writer');
  await bucket.delete(racedKey);
  await restoreRecoveryMedia(bucket, backup, recoveredAt);
  await db.batch(recoveryPreparation(recoveredAt).map(sql => db.prepare(sql)));
  const checks = await verifyRecoveredFixture(runtime, fixture);
  Object.assign(report, { status: 'passed', applicationTables: Object.keys(original).length, capturedObjects: manifest.objects.length,
    restoredObjects: manifest.objects.filter(item => item.retainedUntil === null || item.retainedUntil > recoveredAt).length,
    checks: { exactDatabaseRoundTrip: true, foreignKeysAndIntegrity: true, corruptionRejected: true, unindexedCaptureRejected: true,
      occupiedBucketRejected: true, concurrentObjectNotOverwritten: true, ...checks } });
  console.log('Recovery drill passed: exact D1 export/import, retained R2 bytes, revoked credentials and restored application reads.');
} catch (error) {
  report.status = 'failed';
  report.error = 'Recovery drill failed; see command output. No hosted state was accessed.';
  throw error;
} finally {
  let cleanupError;
  try { await close(); } catch (error) { cleanupError = error; }
  try { await rm(temporary, { recursive: true, force: true }); } catch (error) { cleanupError ??= error; }
  if (cleanupError) { report.status = 'failed'; report.error = 'Recovery runtime/storage cleanup failed.'; }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'run.json'), JSON.stringify(report, null, 2));
  if (cleanupError) throw cleanupError;
}
