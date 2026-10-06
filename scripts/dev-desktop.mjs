#!/usr/bin/env node
/**
 * Local Desktop: control plane + relay on 0.0.0.0:8787, Electron + join links on the LAN IP.
 * Usage: bun desktop
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultLanOrigin } from './lan-origin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = (process.env['OPENROOM_ORIGIN'] ?? defaultLanOrigin(8787)).replace(/\/$/, '');
const readyUrl = `${origin}/api/auth/status`;

function run(command, args, cwd = root) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited ${String(code)}`));
    });
  });
}

async function originReady() {
  try {
    const res = await fetch(readyUrl, { signal: AbortSignal.timeout(1_500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForOrigin(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await originReady()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`Local worker did not become ready at ${origin}`);
}

function needBuild(rel) {
  return !existsSync(resolve(root, rel));
}

console.log(`OpenRoom Desktop → ${origin}`);
console.log(`Phones on this Wi-Fi join at ${origin}/join/`);

const filters = [];
if (needBuild('apps/workspace/dist/index.html')) filters.push('openroom-workspace');
if (needBuild('apps/participant/dist/index.html')) filters.push('openroom-participant');
if (needBuild('apps/stage/dist/index.html')) filters.push('openroom-stage');
if (filters.length > 0) {
  console.log(`Building ${filters.join(', ')}…`);
  await run('bun', ['run', '--filter', ...filters.flatMap((name, i) => (i === 0 ? [name] : ['--filter', name])), 'build']);
}

console.log('Building desktop shell…');
await run('bun', ['run', '--filter', 'openroom-desktop', 'build']);
await run('bun', ['run', 'build:worker']);
console.log('Applying local D1 migrations…');
await new Promise((resolvePromise, reject) => {
  const child = spawn('bunx', ['wrangler', 'd1', 'migrations', 'apply', 'openroom', '--local'], {
    cwd: resolve(root, 'apps/workspace-worker'),
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`wrangler d1 migrations apply exited ${String(code)}`));
  });
});

let worker = null;
if (await originReady()) {
  console.log(`Worker already running at ${origin}`);
} else {
  console.log('Starting local worker…');
  worker = spawn('node', ['scripts/dev-workers.mjs', '--ip', '0.0.0.0', '--port', '8787'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DEMO_AUTH: '1' },
  });
  worker.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`wrangler dev exited ${String(code)}`);
      process.exitCode = code;
    }
  });
  await waitForOrigin(90_000);
}

try {
  const status = await fetch(readyUrl, { signal: AbortSignal.timeout(3_000) }).then((res) => res.json());
  if (status?.demo !== true) {
    console.warn(
      'Local Desktop expects demo login. Set DEMO_AUTH=1 in apps/workspace-worker/.dev.vars and restart the worker.',
    );
  }
} catch {
  /* status probe is advisory */
}

/**
 * `OPENROOM_DEBUG_PORT=9222 bun desktop` opens Chromium's DevTools protocol on
 * that port, so a debugger — or an agent — can read the renderer's console and
 * drive the window instead of inferring what happened from this log.
 */
const debugPort = process.env['OPENROOM_DEBUG_PORT'] ?? '';
if (debugPort !== '') console.log(`DevTools protocol on http://127.0.0.1:${debugPort}/json`);

console.log('Opening Desktop…');
const electron = spawn('bun', ['run', 'start:local'], {
  cwd: resolve(root, 'apps/desktop'),
  stdio: 'inherit',
  env: { ...process.env, OPENROOM_ORIGIN: origin },
});

const shutdown = () => {
  electron.kill('SIGTERM');
  worker?.kill('SIGTERM');
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

electron.on('exit', (code) => {
  worker?.kill('SIGTERM');
  process.exit(code ?? 0);
});
