import { spawn } from 'node:child_process';
import { once } from 'node:events';

const children = new Set();
export const bun = process.platform === 'win32' ? 'bun.exe' : 'bun';
export function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32', ...options });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}
export async function run(command, args, options = {}) {
  const child = start(command, args, options);
  await completed(child, `${command} ${args.join(' ')}`);
}
export async function completed(child, label) {
  const [code, signal] = await once(child, 'close');
  if (code !== 0) throw new Error(`${label} failed (${signal ?? code})`);
}
export async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  const signalTree = (signal) => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  signalTree('SIGTERM');
  const timer = setTimeout(() => signalTree('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(timer); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await Promise.all([...children].map(stop));
  process.exit(1);
});
