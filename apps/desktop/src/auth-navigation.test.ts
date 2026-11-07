import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createDesktopSignInBinding,
  decideDesktopNavigation,
  desktopGoogleStartUrl,
  isTrustedDesktopUrl,
  parseDesktopAuthHandoff,
  parseDesktopDeckHandoff,
  withDesktopAuthFlag,
} from './auth-navigation.js';

const origin = 'https://openroom.app';

describe('desktop Google sign-in navigation', () => {
  it('sends the whole /api/auth/google start to the system browser, with desktop=1 and its challenge', () => {
    expect(decideDesktopNavigation(`${origin}/api/auth/google`, origin)).toBe('open-auth-start');
    expect(withDesktopAuthFlag(`${origin}/api/auth/google`, 'c1')).toBe(
      `${origin}/api/auth/google?desktop=1&desktop_challenge=c1`,
    );
    expect(desktopGoogleStartUrl(origin, 'c1')).toBe(`${origin}/api/auth/google?desktop=1&desktop_challenge=c1`);
  });

  it('holds a verifier only for a sign-in it started, and its challenge is the S256 of it', () => {
    let clock = 0;
    const signIn = createDesktopSignInBinding(() => clock);
    expect(signIn.verifier()).toBeNull();
    const challenge = signIn.begin();
    const verifier = signIn.verifier() as string;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(signIn.begin()).toBe(challenge);
    signIn.finish();
    expect(signIn.verifier()).toBeNull();
    signIn.begin();
    clock += 11 * 60 * 1000;
    expect(signIn.verifier()).toBeNull();
  });

  it('does not forward Google’s own redirect hop — that split the PKCE cookie', () => {
    expect(decideDesktopNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', origin)).toBe(
      'ignore',
    );
    expect(decideDesktopNavigation('https://accounts.youtube.com/accounts/CheckCookie', origin)).toBe('ignore');
  });

  it('still allows the hosted workspace and the local renderer', () => {
    expect(decideDesktopNavigation(`${origin}/host/index.html#/`, origin)).toBe('allow');
    expect(decideDesktopNavigation('openroom://app/core/index.html#/file', origin)).toBe('allow');
  });

  it('opens ordinary external links in the system browser', () => {
    expect(decideDesktopNavigation('https://example.com/docs', origin)).toBe('open-external');
  });

  it('keeps lookalike hosts, userinfo URLs and local resources out of a bridged window', () => {
    for (const url of [
      'https://openroom.app.evil.example/landing',
      'https://openroom.app@evil.example/landing',
      'https://openroom.app:8443/landing',
      'http://openroom.app/landing',
    ]) {
      expect(decideDesktopNavigation(url, origin)).toBe('open-external');
      expect(isTrustedDesktopUrl(url, origin)).toBe(false);
    }
    expect(decideDesktopNavigation('openroom://local/3/resource', origin)).toBe('ignore');
    expect(isTrustedDesktopUrl('openroom://local/3/resource', origin)).toBe(false);
    expect(isTrustedDesktopUrl('openroom://app@evil/core/index.html', origin)).toBe(false);
    expect(isTrustedDesktopUrl('openroom://app/core/index.html#/present', origin)).toBe(true);
    expect(isTrustedDesktopUrl(`${origin}/host/index.html#/`, origin)).toBe(true);
  });

  it('reads the one-time handoff ticket from openroom://auth', () => {
    expect(parseDesktopAuthHandoff('openroom://auth/desktop?ticket=abc_123')).toBe('abc_123');
    expect(parseDesktopAuthHandoff('openroom://app/host/index.html')).toBeNull();
    expect(parseDesktopAuthHandoff('https://openroom.app/api/auth/google/callback')).toBeNull();
  });

  it('accepts only an HTTPS-origin deck handoff', () => {
    expect(parseDesktopDeckHandoff(
      'openroom://deck/open?origin=https%3A%2F%2Fopenroom.app&deckId=deck%201',
    )).toEqual({ origin: 'https://openroom.app', deckId: 'deck 1' });
    expect(parseDesktopDeckHandoff(
      'openroom://deck/open?origin=http%3A%2F%2Fopenroom.app&deckId=d1',
    )).toBeNull();
    expect(parseDesktopDeckHandoff('openroom://deck/open?deckId=d1')).toBeNull();
    expect(parseDesktopDeckHandoff('openroom://auth/desktop?ticket=x')).toBeNull();
  });
});
