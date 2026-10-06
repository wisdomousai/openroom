/**
 * The live server a signed-out desktop presents through: an OpenRoom relay
 * (apps/relay) the teacher or their school runs.
 *
 * The relay key is encrypted with the OS keychain through Electron
 * safeStorage, exactly like the API-key host's BYOK keys (agents/keys.ts).
 * It leaves the main process only as the bearer of `POST /api/sessions`
 * on the configured relay; the renderer sees whether a key is set, never the
 * key.
 *
 * Every session the relay creates is recorded with its origin, so the
 * `openroom://app/api/sessions/<code>/…` proxy in main.ts sends that session's
 * state, commands, assets and exports to the relay instead of the control
 * plane. The editor itself does not know which server runs the session.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { SafeStorageLike } from './agents/keys.js';

export interface RelayStatus {
  /** `https://…` origin, or null when no live server is set. */
  origin: string | null;
  hasKey: boolean;
  /** True when origin and key come from the environment and cannot be edited here. */
  fromEnv: boolean;
  /** False when the computer has no OS keychain; a key can then only come from the environment. */
  keychain: boolean;
}

export interface RelayCreatedSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  /** Absolute participant link on the relay (or its JOIN_ORIGIN). */
  joinUrl: string;
  /** The relay origin the session lives on. */
  origin: string;
}

export type RelayStartResult = { ok: true; session: RelayCreatedSession } | { ok: false, message: string };

export interface RelayStoreDeps {
  file(): string;
  /** Resolved per call: Electron's safeStorage is absent in tests and on some Linux desktops. */
  safeStorage(): SafeStorageLike | null;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  readFile?(path: string): Promise<string>;
  writeFile?(path: string, text: string): Promise<void>;
}

export interface RelayStore {
  /** Load recorded sessions so `originFor` routes them after a restart. */
  hydrate(): Promise<void>;
  status(): Promise<RelayStatus>;
  /** Set the origin; a non-empty key replaces the stored one, an empty key keeps it. */
  save(input: { origin: string; key?: string }): Promise<RelayStatus>;
  clear(): Promise<RelayStatus>;
  startSession(outline: unknown): Promise<RelayStartResult>;
  /** Origin for an `/api/sessions/<code>/…` path of a relay session; null for everything else. */
  originFor(pathname: string): string | null;
}

export const RELAY_NO_KEYCHAIN_MESSAGE =
  'This computer has no OS keychain, so OpenRoom will not store a live server key on disk.';

/** Sessions route to their relay for a day; a relay session does not outlive that. */
export const RELAY_SESSION_ROUTE_MS = 24 * 60 * 60 * 1000;

interface StoredRelay {
  version: 1;
  origin?: string;
  secret?: string;
  sessions?: Record<string, { origin: string; expiresAt: number }>;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `https://host[:port]`, or `http://` on loopback for a relay under `bun run dev:relay`. */
export function normalizeRelayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter the live server address, for example https://live.example.org.');
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (!secure) throw new Error('The live server address must start with https://.');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    throw new Error('Enter only the live server address, without a path.');
  }
  return url.origin;
}

function sessionCodeOf(pathname: string): string | null {
  const match = /^\/api\/sessions\/([^/]+)\//.exec(pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] as string).trim().toUpperCase();
  } catch {
    return null;
  }
}

async function writeSecretFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

function failure(status: number, body: unknown): string {
  const error = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['error'] : undefined;
  if (status === 401) return 'The live server rejected the key.';
  if (error === 'creation-disabled') return 'The live server does not accept new sessions.';
  if (error === 'identity-mode-unavailable') {
    return 'The live server runs anonymous and pseudonymous sessions only. Sign in for named or roster sessions.';
  }
  if (status === 422) return 'The live server rejected this file.';
  return `Live server error (HTTP ${String(status)}).`;
}

export function createRelayStore(deps: RelayStoreDeps): RelayStore {
  const env = deps.env ?? process.env;
  const request = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const write = deps.writeFile ?? writeSecretFile;
  const routes = new Map<string, { origin: string; expiresAt: number }>();

  const load = async (): Promise<StoredRelay> => {
    try {
      const parsed = JSON.parse(await read(deps.file())) as StoredRelay;
      return typeof parsed === 'object' && parsed !== null ? { ...parsed, version: 1 } : { version: 1 };
    } catch {
      return { version: 1 };
    }
  };
  const persist = (stored: StoredRelay): Promise<void> => write(deps.file(), `${JSON.stringify(stored, null, 2)}\n`);

  const keychain = (): boolean => {
    try {
      return deps.safeStorage()?.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  };

  const envRelay = (): { origin: string; key: string } | null => {
    const origin = env['OPENROOM_RELAY_ORIGIN']?.trim() ?? '';
    const key = env['OPENROOM_RELAY_KEY']?.trim() ?? '';
    if (origin === '' || key === '') return null;
    return { origin: normalizeRelayOrigin(origin), key };
  };

  const decrypt = (secret: string | undefined): string | null => {
    if (secret === undefined || secret === '' || !keychain()) return null;
    try {
      const plain = deps.safeStorage()?.decryptString(Buffer.from(secret, 'base64')) ?? '';
      return plain === '' ? null : plain;
    } catch {
      return null;
    }
  };

  const status = async (): Promise<RelayStatus> => {
    const fromEnv = envRelay();
    if (fromEnv !== null) return { origin: fromEnv.origin, hasKey: true, fromEnv: true, keychain: keychain() };
    const stored = await load();
    return { origin: stored.origin ?? null, hasKey: (stored.secret ?? '') !== '', fromEnv: false, keychain: keychain() };
  };

  const credential = async (): Promise<{ origin: string; key: string } | null> => {
    const fromEnv = envRelay();
    if (fromEnv !== null) return fromEnv;
    const stored = await load();
    const key = decrypt(stored.secret);
    return stored.origin === undefined || key === null ? null : { origin: stored.origin, key };
  };

  const prune = (sessions: StoredRelay['sessions']): Record<string, { origin: string; expiresAt: number }> => {
    const at = now();
    return Object.fromEntries(Object.entries(sessions ?? {}).filter(([, entry]) => entry.expiresAt > at));
  };

  return {
    async hydrate() {
      for (const [code, entry] of Object.entries(prune((await load()).sessions))) routes.set(code, entry);
    },

    status,

    async save(input) {
      if (envRelay() !== null) throw new Error('The live server is set by the environment.');
      const origin = normalizeRelayOrigin(input.origin);
      const stored = await load();
      const key = input.key?.trim() ?? '';
      if (key !== '') {
        const store = deps.safeStorage();
        if (store === null || !keychain()) throw new Error(RELAY_NO_KEYCHAIN_MESSAGE);
        stored.secret = store.encryptString(key).toString('base64');
      } else if ((stored.secret ?? '') === '' || stored.origin !== origin) {
        // A key belongs to the server it was issued by.
        throw new Error('Enter the live server key.');
      }
      stored.origin = origin;
      await persist(stored);
      return status();
    },

    async clear() {
      if (envRelay() !== null) throw new Error('The live server is set by the environment.');
      const stored = await load();
      delete stored.origin;
      delete stored.secret;
      await persist(stored);
      return status();
    },

    async startSession(outline) {
      const relay = await credential();
      if (relay === null) return { ok: false, message: 'No live server is set.' };
      let response: Response;
      try {
        response = await request(`${relay.origin}/api/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${relay.key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ outline }),
        });
      } catch {
        return { ok: false, message: `${relay.origin} is unreachable.` };
      }
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.status !== 201 || body === null || typeof body['sessionCode'] !== 'string') {
        return { ok: false, message: failure(response.status, body) };
      }
      const sessionCode = (body['sessionCode'] as string).toUpperCase();
      const entry = { origin: relay.origin, expiresAt: now() + RELAY_SESSION_ROUTE_MS };
      routes.set(sessionCode, entry);
      const stored = await load();
      stored.sessions = { ...prune(stored.sessions), [sessionCode]: entry };
      await persist(stored);
      const joinPath = typeof body['joinUrl'] === 'string' ? body['joinUrl'] : `/join/?code=${encodeURIComponent(sessionCode)}`;
      return {
        ok: true,
        session: {
          sessionCode,
          code: sessionCode,
          hostToken: String(body['hostToken']),
          stageToken: String(body['stageToken']),
          joinUrl: new URL(joinPath, `${relay.origin}/`).toString(),
          origin: relay.origin,
        },
      };
    },

    originFor(pathname) {
      const code = sessionCodeOf(pathname);
      if (code === null) return null;
      const entry = routes.get(code);
      if (entry === undefined) return null;
      if (entry.expiresAt <= now()) {
        routes.delete(code);
        return null;
      }
      return entry.origin;
    },
  };
}

export function defaultRelayFile(userData: string): string {
  return join(userData, 'live-server.json');
}
