#!/usr/bin/env node
/**
 * Collect the built front-ends into `public/` so the ASSETS binding can
 * serve them:
 *
 *   ../host/dist    → public/host/
 *   ../office/dist  → public/office/
 *
 * The stage and participant apps ship with the relay (apps/relay).
 *
 * Plus the built Astro marketing site in ../site:
 *
 *   ../site/dist  → public/   (owns root index.html for openroom.app SEO)
 *
 * Missing sibling builds are skipped silently — the Worker and its tests do not
 * depend on the apps being built.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..');
const appsRoot = resolve(workerRoot, '..');
const publicDir = join(workerRoot, 'public');

/** Files in public/ that are ours, not build output. */
const KEEP = new Set(['.gitkeep', '_headers', 'favicon.svg']);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanPublic() {
  await mkdir(publicDir, { recursive: true });
  for (const entry of await readdir(publicDir)) {
    if (KEEP.has(entry)) continue;
    await rm(join(publicDir, entry), { recursive: true, force: true });
  }
}

async function collect(app, target) {
  const source = join(appsRoot, app, 'dist');
  if (!(await exists(source))) {
    console.log(`[collect-assets] skip ${app} (no dist)`);
    return false;
  }
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(`[collect-assets] ${app}/dist → ${target.replace(workerRoot + '/', '')}`);
  return true;
}

/** Copy the built Astro site into public/ (merged over the app builds). */
async function collectSiteDist() {
  const source = join(appsRoot, 'site', 'dist');
  if (!(await exists(source))) {
    console.log('[collect-assets] skip site/dist (missing — run bun run --filter openroom-site build)');
    return false;
  }
  await mkdir(publicDir, { recursive: true });
  await cp(source, publicDir, { recursive: true });
  console.log(`[collect-assets] site/dist → ${publicDir.replace(workerRoot + '/', '')}`);
  return true;
}

const anyDist =
  (await exists(join(appsRoot, 'host', 'dist'))) ||
  (await exists(join(appsRoot, 'office', 'dist')));

if (!anyDist) {
  console.log('[collect-assets] no sibling app builds found; nothing to do');
} else {
  await cleanPublic();
  await collect('host', join(publicDir, 'host'));
  await collect('office', join(publicDir, 'office'));
}

// Site last: owns root index.html (SEO landing).
await collectSiteDist();
