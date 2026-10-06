import { describe, expect, it } from 'vitest';

import {
  decideDesktopNavigation,
  desktopGoogleStartUrl,
  parseDesktopAuthHandoff,
  parseDesktopDeckHandoff,
  withDesktopAuthFlag,
} from './auth-navigation.js';

const origin = 'https://openroom.app';

describe('desktop Google sign-in navigation', () => {
  it('sends the whole /api/auth/google start to the system browser, with desktop=1', () => {
    expect(decideDesktopNavigation(`${origin}/api/auth/google`, origin)).toBe('open-auth-start');
    expect(withDesktopAuthFlag(`${origin}/api/auth/google`)).toBe(`${origin}/api/auth/google?desktop=1`);
    expect(desktopGoogleStartUrl(origin)).toBe(`${origin}/api/auth/google?desktop=1`);
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
