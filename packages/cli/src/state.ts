import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CliError } from './output.js';

export const STATE_FILENAME = '.openroom.json';

export interface SessionState {
  url: string;
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken?: string;
  joinUrl?: string;
  stageUrl?: string;
  createdAt?: string;
}

export function statePath(cwd: string = process.cwd()): string {
  return resolve(cwd, STATE_FILENAME);
}

export function readState(cwd: string = process.cwd()): SessionState | null {
  let text: string;
  try {
    text = readFileSync(statePath(cwd), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<SessionState>;
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.sessionCode !== 'string' ||
      typeof parsed.hostToken !== 'string'
    ) {
      return null;
    }
    return { code: '', ...parsed } as SessionState;
  } catch {
    return null;
  }
}

export function requireState(cwd: string = process.cwd()): SessionState {
  const state = readState(cwd);
  if (state === null) {
    throw new CliError(
      `no active session (${STATE_FILENAME} missing or unreadable) — run "openroom session start" first`,
      { code: 'E_NO_SESSION' },
    );
  }
  return state;
}

export function writeState(state: SessionState, cwd: string = process.cwd()): string {
  const path = statePath(cwd);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}
