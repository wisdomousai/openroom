#!/usr/bin/env node
/**
 * Collect the live front-ends into `public/` so the relay's ASSETS binding
 * serves them:
 *
 *   ../participant/dist → public/join/
 *   ../stage/dist       → public/stage/
 *
 * Missing builds are skipped — the relay and its tests do not depend on them.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const relayRoot = resolve(here, '..');
const appsRoot = resolve(relayRoot, '..');
const publicDir = join(relayRoot, 'public');

/** Files in public/ that are ours, not build output. */
const KEEP = new Set(['_headers', 'favicon.svg']);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(publicDir, { recursive: true });
for (const entry of await readdir(publicDir)) {
  if (KEEP.has(entry)) continue;
  await rm(join(publicDir, entry), { recursive: true, force: true });
}

for (const [app, target] of [
  ['participant', 'join'],
  ['stage', 'stage'],
]) {
  const source = join(appsRoot, app, 'dist');
  if (!(await exists(source))) {
    console.log(`[relay:collect-assets] skip ${app} (no dist)`);
    continue;
  }
  await cp(source, join(publicDir, target), { recursive: true });
  console.log(`[relay:collect-assets] ${app}/dist → public/${target}`);
}
