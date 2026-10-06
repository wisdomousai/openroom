/**
 * Local dev for both Workers: the relay (apps/relay, port 8790) and the control
 * plane (apps/worker, the front door on 8787 unless arguments say otherwise).
 *
 * Two `wrangler dev` processes, not one `wrangler dev -c … -c …`: a single
 * Miniflare backs every Worker's static assets with one shared disk, so the
 * relay would serve the control plane's files for /stage/ and /join/. Separate
 * processes find each other through the local dev registry, which connects the
 * control plane's RELAY service binding and cross-script SessionDO binding.
 * https://developers.cloudflare.com/workers/local-development/multi-workers/
 *
 * Arguments are passed to the control plane's `wrangler dev`.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let stopping = false;

function start(name, cwd, args) {
  const child = spawn('bun', ['x', 'wrangler', 'dev', ...args], { cwd: resolve(root, cwd), stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} exited ${String(code ?? signal)}`);
    stop(code ?? 1);
  });
  children.push(child);
}

function stop(code = 0) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

// Each process needs its own inspector port; the control plane keeps the default.
start('relay', 'apps/relay', ['--port', '8790', '--inspector-port', '9230']);
start('control plane', 'apps/worker', process.argv.slice(2));
