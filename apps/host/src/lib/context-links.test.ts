import { describe, expect, it } from 'vitest';

import { learnerLinkUrl, linkState, liveLinkCount } from './context-links';

const HOUR = 60 * 60 * 1000;

describe('context access link state', () => {
  const now = 1_700_000_000_000;

  it('is active while unrevoked and unexpired', () => {
    expect(linkState({ expiresAt: now + HOUR, revokedAt: null }, now)).toBe('active');
    expect(linkState({ expiresAt: null, revokedAt: null }, now)).toBe('active');
  });

  it('expires on the boundary, not after it', () => {
    expect(linkState({ expiresAt: now, revokedAt: null }, now)).toBe('expired');
    expect(linkState({ expiresAt: now - 1, revokedAt: null }, now)).toBe('expired');
  });

  it('reports revoked even when the clock also ran out', () => {
    // The tutor withdrew it; that is the fact they are looking for.
    expect(linkState({ expiresAt: now - HOUR, revokedAt: now - 2 * HOUR }, now)).toBe('revoked');
  });

  it('counts only links that still work against the cap', () => {
    const links = [
      { expiresAt: now + HOUR, revokedAt: null },
      { expiresAt: null, revokedAt: null },
      { expiresAt: now - HOUR, revokedAt: null },
      { expiresAt: now + HOUR, revokedAt: now - HOUR },
    ];
    expect(liveLinkCount(links, now)).toBe(2);
  });
});

describe('learner link URL', () => {
  it('is the URL the #/learn route parses, token in the fragment', () => {
    expect(learnerLinkUrl('https://app.example', '/', 'orlnk_a_b')).toBe(
      'https://app.example#/learn?token=orlnk_a_b',
    );
    expect(learnerLinkUrl('https://app.example', '/host/', 'orlnk_a_b')).toBe(
      'https://app.example/host#/learn?token=orlnk_a_b',
    );
  });
});
