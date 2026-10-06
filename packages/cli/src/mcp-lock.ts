/** Lock beside a `.openroom` so desktop and headless never both write. */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export type McpLockHost = 'desktop' | 'headless';

export interface McpFileLock {
  fileId: string;
  pid: number;
  host: McpLockHost;
}

export function lockPathFor(documentPath: string): string {
  return `${documentPath}.lock`;
}

export function readLock(documentPath: string): McpFileLock | null {
  try {
    const raw = JSON.parse(readFileSync(lockPathFor(documentPath), 'utf8')) as Partial<McpFileLock>;
    if (typeof raw.fileId !== 'string' || typeof raw.pid !== 'number') return null;
    if (raw.host !== 'desktop' && raw.host !== 'headless') return null;
    return { fileId: raw.fileId, pid: raw.pid, host: raw.host };
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function liveLock(documentPath: string): McpFileLock | null {
  const lock = readLock(documentPath);
  if (lock === null) return null;
  if (!pidAlive(lock.pid)) {
    try {
      unlinkSync(lockPathFor(documentPath));
    } catch {
      /* stale */
    }
    return null;
  }
  return lock;
}

export function writeLock(documentPath: string, lock: McpFileLock): void {
  writeFileSync(lockPathFor(documentPath), `${JSON.stringify(lock)}\n`, 'utf8');
}

export function clearLock(documentPath: string, pid: number): void {
  const current = readLock(documentPath);
  if (current === null || current.pid !== pid) return;
  try {
    unlinkSync(lockPathFor(documentPath));
  } catch {
    /* already gone */
  }
}

export function takeHeadlessLock(documentPath: string, fileId: string): { ok: true } | { ok: false; reason: 'desktop-open' } {
  const live = liveLock(documentPath);
  if (live !== null && live.host === 'desktop') return { ok: false, reason: 'desktop-open' };
  if (live !== null && live.host === 'headless' && live.pid !== process.pid) {
    return { ok: false, reason: 'desktop-open' };
  }
  writeLock(documentPath, { fileId, pid: process.pid, host: 'headless' });
  return { ok: true };
}

export function desktopHolds(documentPath: string): boolean {
  const live = liveLock(documentPath);
  return live !== null && live.host === 'desktop';
}
