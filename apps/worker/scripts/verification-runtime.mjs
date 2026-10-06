/** Serve the actual bundled Worker through Miniflare, without the Wrangler dev proxy. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

const [configFile, bundleFile, persist, portValue, ...extra] = process.argv.slice(2);
const port = Number(portValue);
if (!configFile || !bundleFile || !persist || extra.length || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Usage: verification-runtime.mjs <local-config> <bundle> <persist> <port>');
}
const config = JSON.parse(await readFile(configFile, 'utf8'));
if (config.name !== 'openroom-verification' || config.vars?.ADMIN_KEY !== 'dev-admin' || config.routes || config.account_id) {
  throw new Error('Only the disposable verification configuration is supported.');
}
const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(configFile);
const runtime = new Miniflare({
  host: '127.0.0.1', port, cf: false,
  resourcePersistencePath: resolve(persist, 'v3'),
  workers: [
    { ...workerOptions, name: config.name, modules: true, modulesRoot: dirname(bundleFile), scriptPath: bundleFile },
    ...externalWorkers,
  ],
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
