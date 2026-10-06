/**
 * Serve actual bundled Workers through one Miniflare, without the Wrangler dev
 * proxy. The first config/bundle pair answers on the port; the others are
 * reachable only through bindings (the control plane's cross-script SessionDO
 * and RELAY service binding resolve to the relay listed after it).
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

const [persist, portValue, ...pairs] = process.argv.slice(2);
const port = Number(portValue);
if (!persist || !Number.isInteger(port) || port < 1 || port > 65535 || pairs.length === 0 || pairs.length % 2 !== 0) {
  throw new Error('Usage: verification-runtime.mjs <persist> <port> <local-config> <bundle> [<local-config> <bundle> ...]');
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
  workers.push({ ...workerOptions, name: config.name, modules: true, modulesRoot: dirname(bundleFile), scriptPath: bundleFile });
  external.push(...externalWorkers);
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
