import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sandboxed preloads have no ESM loader — they must be CJS (`require('electron')`).
const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, '../src/preload.ts')],
  outfile: resolve(here, '../dist/preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});
