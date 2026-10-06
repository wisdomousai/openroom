import { describe, expect, it } from 'vitest';

import { NO_KEYCHAIN_MESSAGE, createAgentKeyStore, type SafeStorageLike } from './keys.js';

/** Reversible stand-in for the OS keychain: enough to prove the file never holds plaintext. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
    decryptString: (encrypted) => encrypted.toString('utf8').replace(/^sealed:/, ''),
  };
}

function memoryStore(options: { safeStorage?: SafeStorageLike | null; env?: NodeJS.ProcessEnv } = {}) {
  const files = new Map<string, string>();
  const store = createAgentKeyStore({
    file: () => '/userData/agent-keys.json',
    safeStorage: () => (options.safeStorage === undefined ? fakeSafeStorage() : options.safeStorage),
    env: options.env ?? {},
    readFile: (path) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text);
    },
    writeFile: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
  });
  return { store, files };
}

describe('createAgentKeyStore', () => {
  it('round-trips a key without ever listing the secret', async () => {
    const { store, files } = memoryStore();
    await store.set('google', { apiKey: 'AIza-secret' });

    const listed = await store.list();
    const google = listed.find((entry) => entry.providerId === 'google');
    expect(google).toEqual({ providerId: 'google', hasKey: true, accountId: null, fromEnv: false });
    expect(JSON.stringify(listed)).not.toContain('AIza-secret');
    expect(files.get('/userData/agent-keys.json')).not.toContain('AIza-secret');
    expect(await store.resolve('google')).toEqual({ apiKey: 'AIza-secret' });
    expect(await store.configured()).toEqual(['google']);
  });

  it('writes nothing when the computer has no keychain', async () => {
    const { store, files } = memoryStore({ safeStorage: null });
    await expect(store.set('openai', { apiKey: 'sk-live' })).rejects.toThrow(NO_KEYCHAIN_MESSAGE);
    expect(files.size).toBe(0);
    expect(store.available()).toBe(false);
  });

  it('rejects Cloudflare without an account id', async () => {
    const { store } = memoryStore();
    await expect(store.set('cloudflare', { apiKey: 'cf-token' })).rejects.toThrow(/account ID/);
    await store.set('cloudflare', { apiKey: 'cf-token', accountId: 'acct-1' });
    expect(await store.resolve('cloudflare')).toEqual({ apiKey: 'cf-token', accountId: 'acct-1' });
  });

  it('resolves an environment key with no file and no keychain', async () => {
    const { store, files } = memoryStore({
      safeStorage: null,
      env: { OPENROOM_BYOK_GROQ_API_KEY: 'gsk-env' },
    });

    expect(await store.resolve('groq')).toEqual({ apiKey: 'gsk-env' });
    expect(await store.configured()).toEqual(['groq']);
    const groq = (await store.list()).find((entry) => entry.providerId === 'groq');
    expect(groq?.fromEnv).toBe(true);
    expect(files.size).toBe(0);
  });

  it('forgets a cleared key', async () => {
    const { store } = memoryStore();
    await store.set('mistral', { apiKey: 'mk-1' });
    await store.clear('mistral');
    expect(await store.resolve('mistral')).toBeNull();
    expect(await store.configured()).toEqual([]);
  });
});
