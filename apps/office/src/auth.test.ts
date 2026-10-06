import { describe, expect, it } from 'vitest';
import { authorizationCode, authorizationRequest, CLIENT_ID } from './auth';

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
