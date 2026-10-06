/**
 * Serve actual bundled Workers through one Miniflare, without the Wrangler dev
 * proxy. The first config/bundle pair answers on the port; the others are
 * reachable only through bindings (the control plane's cross-script SessionDO
 * and RELAY service binding resolve to the relay listed after it).
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

const [persist, portValue, ...pairs] = process.argv.slice(2);
const port = Number(portValue);
if (!persist || !Number.isInteger(port) || port < 1 || port > 65535 || pairs.length === 0 || pairs.length % 2 !== 0) {
  throw new Error('Usage: verification-runtime.mjs <persist> <port> <local-config> <bundle> [<local-config> <bundle> ...]');
}
/**
 * Miniflare names a worker's asset services after `assets.workerName`, which
 * unstable_getMiniflareWorkerOptions leaves unset, and backs every worker's
 * assets with one shared disk service (`assets:storage`, the last directory
 * wins). Two Workers with assets in one Miniflare (control plane + relay) would
 * read each other's files. Each worker keeps its own name and manifest, and
 * the disk is one merged copy: the later Workers' files first, the primary's on
 * top. Their trees do not overlap except `_headers` and `favicon.svg`, where
 * the relay's are the same policy and icon as the control plane's.
 */
const assetDirectories = [];
function ownAssets(workerOptions, name) {
  if (!workerOptions.assets) return {};
  assetDirectories.push(workerOptions.assets.directory);
  return { assets: { ...workerOptions.assets, workerName: name } };
}
const workers = [];
const external = [];
for (let index = 0; index < pairs.length; index += 2) {
  const configFile = pairs[index];
  const bundleFile = pairs[index + 1];
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const disposable =
    typeof config.name === 'string' &&
    config.name.endsWith('-verification') &&
    !config.routes &&
    !config.account_id &&
    (config.vars?.ADMIN_KEY === 'dev-admin' || config.vars?.RELAY_KEY === 'dev-relay');
  if (!disposable) throw new Error('Only the disposable verification configurations are supported.');
  const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(configFile);
  workers.push({ ...workerOptions, ...ownAssets(workerOptions, config.name), name: config.name, modules: true, modulesRoot: dirname(bundleFile), scriptPath: bundleFile });
  external.push(...externalWorkers);
}
if (assetDirectories.length > 1) {
  const merged = resolve(persist, 'merged-assets');
  await rm(merged, { recursive: true, force: true });
  await mkdir(merged, { recursive: true });
  for (const directory of [...assetDirectories].reverse()) await cp(directory, merged, { recursive: true, force: true });
  for (const worker of workers) if (worker.assets) worker.assets = { ...worker.assets, directory: merged };
}
const named = new Set(workers.map((worker) => worker.name));
const runtime = new Miniflare({
  host: '127.0.0.1', port, cf: false,
  resourcePersistencePath: resolve(persist, 'v3'),
  workers: [...workers, ...external.filter((worker) => !named.has(worker.name))],
});
const stopped = new Promise((accept) => {
  process.once('SIGINT', accept);
  process.once('SIGTERM', accept);
});
try {
  console.log(`Direct local verification runtime ready at ${await runtime.ready}`);
  await stopped;
} finally {
  await runtime.dispose();
}
