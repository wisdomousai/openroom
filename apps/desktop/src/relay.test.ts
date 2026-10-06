import { describe, expect, it } from 'vitest';

import type { SafeStorageLike } from './agents/keys.js';
import { RELAY_NO_KEYCHAIN_MESSAGE, RELAY_SESSION_ROUTE_MS, createRelayStore, normalizeRelayOrigin } from './relay.js';

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
    decryptString: (encrypted) => encrypted.toString('utf8').replace(/^sealed:/, ''),
  };
}

interface Call { url: string; init: RequestInit }

function harness(options: {
  safeStorage?: SafeStorageLike | null;
  env?: NodeJS.ProcessEnv;
  respond?: (call: Call) => Response;
} = {}) {
  const files = new Map<string, string>();
  const calls: Call[] = [];
  let clock = 1_000_000;
  const deps = {
    file: () => '/userData/live-server.json',
    safeStorage: () => (options.safeStorage === undefined ? fakeSafeStorage() : options.safeStorage),
    env: options.env ?? {},
    now: () => clock,
    fetch: ((url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return Promise.resolve(
        options.respond?.(call) ??
          Response.json(
            { sessionCode: 'ab12cd', code: 'AB12CD', hostToken: 'host-t', stageToken: 'stage-t', joinUrl: '/join/?code=AB12CD' },
            { status: 201 },
          ),
      );
    }) as typeof fetch,
    readFile: (path: string) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text);
    },
    writeFile: (path: string, text: string) => {
      files.set(path, text);
      return Promise.resolve();
    },
  };
  return { store: createRelayStore(deps), deps, files, calls, advance: (ms: number) => { clock += ms; } };
}

describe('normalizeRelayOrigin', () => {
  it('keeps an https origin and drops the trailing slash', () => {
    expect(normalizeRelayOrigin(' https://live.example.org/ ')).toBe('https://live.example.org');
  });

  it('allows http only on loopback', () => {
    expect(normalizeRelayOrigin('http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
    expect(normalizeRelayOrigin('http://localhost:8790')).toBe('http://localhost:8790');
    expect(() => normalizeRelayOrigin('http://live.example.org')).toThrow(/https/);
  });

  it('rejects paths, queries and credentials', () => {
    expect(() => normalizeRelayOrigin('https://live.example.org/api')).toThrow(/without a path/);
    expect(() => normalizeRelayOrigin('https://live.example.org/?a=1')).toThrow(/without a path/);
    expect(() => normalizeRelayOrigin('https://user:pw@live.example.org')).toThrow(/without a path/);
    expect(() => normalizeRelayOrigin('not a url')).toThrow(/address/);
  });
});

describe('createRelayStore', () => {
  it('stores the key sealed and never reports it', async () => {
    const { store, files } = harness();
    const status = await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    expect(status).toEqual({ origin: 'https://live.example.org', hasKey: true, fromEnv: false, keychain: true });
    expect(JSON.stringify(status)).not.toContain('relay-secret');
    expect(files.get('/userData/live-server.json')).not.toContain('relay-secret');
  });

  it('keeps the stored key when only the address is saved again, but not for a new server', async () => {
    const { store } = harness();
    await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    await expect(store.save({ origin: 'https://live.example.org/' })).resolves.toMatchObject({ hasKey: true });
    await expect(store.save({ origin: 'https://other.example.org' })).rejects.toThrow(/key/);
  });

  it('writes nothing when the computer has no keychain', async () => {
    const { store, files } = harness({ safeStorage: null });
    await expect(store.save({ origin: 'https://live.example.org', key: 'relay-secret' })).rejects.toThrow(RELAY_NO_KEYCHAIN_MESSAGE);
    expect(files.size).toBe(0);
    expect((await store.status()).keychain).toBe(false);
  });

  it('clears the address and the key', async () => {
    const { store } = harness();
    await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    expect(await store.clear()).toEqual({ origin: null, hasKey: false, fromEnv: false, keychain: true });
    expect(await store.startSession({})).toEqual({ ok: false, message: 'No live server is set.' });
  });

  it('creates a session with the key as bearer and routes that session to the relay', async () => {
    const { store, calls } = harness();
    await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    const result = await store.startSession({ title: 'Deck' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://live.example.org/api/sessions');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer relay-secret');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ outline: { title: 'Deck' } });
    expect(result).toEqual({
      ok: true,
      session: {
        sessionCode: 'AB12CD', code: 'AB12CD', hostToken: 'host-t', stageToken: 'stage-t',
        joinUrl: 'https://live.example.org/join/?code=AB12CD', origin: 'https://live.example.org',
      },
    });
    expect(store.originFor('/api/sessions/AB12CD/state')).toBe('https://live.example.org');
    expect(store.originFor('/api/sessions/ab12cd/assets/img')).toBe('https://live.example.org');
    expect(store.originFor('/api/sessions/ZZ99ZZ/state')).toBeNull();
    expect(store.originFor('/api/me')).toBeNull();
    expect(store.originFor('/api/sessions')).toBeNull();
  });

  it('keeps routing recorded sessions after a restart until they expire', async () => {
    const first = harness();
    await first.store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    await first.store.startSession({});
    const restarted = createRelayStore(first.deps);
    expect(restarted.originFor('/api/sessions/AB12CD/state')).toBeNull();
    await restarted.hydrate();
    expect(restarted.originFor('/api/sessions/AB12CD/state')).toBe('https://live.example.org');
    first.advance(RELAY_SESSION_ROUTE_MS);
    expect(restarted.originFor('/api/sessions/AB12CD/state')).toBeNull();
  });

  it('reports relay refusals as facts', async () => {
    const cases: Array<[Response, RegExp]> = [
      [Response.json({ ok: false, error: 'unauthorized' }, { status: 401 }), /rejected the key/],
      [Response.json({ ok: false, error: 'creation-disabled' }, { status: 403 }), /does not accept new sessions/],
      [Response.json({ ok: false, error: 'identity-mode-unavailable' }, { status: 422 }), /anonymous and pseudonymous/],
      [new Response('boom', { status: 502 }), /HTTP 502/],
    ];
    for (const [response, message] of cases) {
      const { store } = harness({ respond: () => response });
      await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
      const result = await store.startSession({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
      expect(store.originFor('/api/sessions/AB12CD/state')).toBeNull();
    }
  });

  it('reports an unreachable relay', async () => {
    const { store } = harness({ respond: () => { throw new TypeError('fetch failed'); } });
    await store.save({ origin: 'https://live.example.org', key: 'relay-secret' });
    expect(await store.startSession({})).toEqual({ ok: false, message: 'https://live.example.org is unreachable.' });
  });

  it('takes origin and key from the environment without a keychain', async () => {
    const { store, calls, files } = harness({
      safeStorage: null,
      env: { OPENROOM_RELAY_ORIGIN: 'http://127.0.0.1:8790/', OPENROOM_RELAY_KEY: 'dev-relay' },
    });
    expect(await store.status()).toEqual({ origin: 'http://127.0.0.1:8790', hasKey: true, fromEnv: true, keychain: false });
    await expect(store.save({ origin: 'https://x.example.org', key: 'k' })).rejects.toThrow(/environment/);
    const result = await store.startSession({});
    expect(result.ok).toBe(true);
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer dev-relay');
    expect(files.get('/userData/live-server.json')).not.toContain('dev-relay');
  });
});
