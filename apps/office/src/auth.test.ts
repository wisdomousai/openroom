import { describe, expect, it } from 'vitest';
import { authorizationCode, authorizationRequest, CLIENT_ID, forgetConnection, rememberConnection, storedConnection } from './auth';

describe('PowerPoint dialog authorization boundary', () => {
  it('binds a random verifier and state to a same-origin fixed callback with S256', async () => {
    const first = await authorizationRequest('https://openroom.test'), second = await authorizationRequest('https://openroom.test');
    expect(first.state).not.toBe(second.state); expect(first.verifier).not.toBe(second.verifier);
    const url = new URL(first.url);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(url.origin).toBe('https://openroom.test');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge')).toBe(expected);
    expect(url.searchParams.get('redirect_uri')).toBe('https://openroom.test/office/callback.html');
  });
  it('rejects messages from another origin, missing origins, swapped state and malformed payloads', () => {
    const origin = 'https://openroom.test', state = 'b'.repeat(43), code = `orcode_${'a'.repeat(43)}`;
    const message = JSON.stringify({ type: 'openroom.oauth', code, state });
    expect(authorizationCode({ origin, message }, origin, state)).toBe(code);
    for (const event of [{ message }, { origin: 'https://attacker.test', message }, { origin, message: 'invalid' }, { origin, message: JSON.stringify({ type: 'openroom.oauth', code, state: 'wrong' }) }, { origin, message: JSON.stringify({ type: 'openroom.oauth', code: 'orauth_secret', state }) }]) expect(authorizationCode(event, origin, state)).toBeNull();
  });
});

describe('stored PowerPoint connection', () => {
  const memory = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); }, items }; };
  const office = (partitionKey?: string) => ({ context: { partitionKey } }) as unknown as typeof Office;
  const connection = { token: `orauth_${'a'.repeat(43)}`, id: 'conn-1', expiresAt: Date.UTC(2026, 11, 7) };
  const now = Date.UTC(2026, 10, 7);
  it('keeps a connection across reloads under the partition key', () => {
    const store = memory();
    rememberConnection(office('p1'), connection, store);
    expect([...store.items.keys()]).toEqual(['p1openroom.connection']);
    expect(storedConnection(office('p1'), store, now)).toEqual(connection);
    expect(storedConnection(office('p2'), store, now)).toBeNull();
  });
  it('drops expired, nearly expired and malformed connections', () => {
    for (const value of [{ ...connection, expiresAt: now + 3_600_000 }, { ...connection, token: 'orauth_short' }, { ...connection, id: 5 }]) {
      const store = memory();
      store.setItem('openroom.connection', JSON.stringify(value));
      expect(storedConnection(office(), store, now)).toBeNull();
      expect(store.items.size).toBe(0);
    }
    const store = memory(); store.setItem('openroom.connection', 'not json');
    expect(storedConnection(office(), store, now)).toBeNull();
  });
  it('forgets the connection on sign-out', () => {
    const store = memory();
    rememberConnection(office(), connection, store); forgetConnection(office(), store);
    expect(storedConnection(office(), store, now)).toBeNull();
  });
});
