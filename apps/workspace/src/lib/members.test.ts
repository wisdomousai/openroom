import { describe, expect, it } from 'vitest';
import { groupSpaces, inviteEmailError, spaceRowOwnsAccent, roleAtLeast } from './members';
import type { MySpace } from '../api';

function space(overrides: Partial<MySpace>): MySpace {
  return {
    id: 's1',
    name: 'Space',
    role: 'owner',
    shared: false,
    settings: { experience: 'classroom' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('groupSpaces', () => {
  it('splits owned and shared spaces', () => {
    const mine = space({ id: 'a' });
    const shared = space({ id: 'b', role: 'editor', shared: true });
    expect(groupSpaces([mine, shared])).toEqual({ mine: [mine], shared: [shared] });
  });

  it('handles empty input', () => {
    expect(groupSpaces([])).toEqual({ mine: [], shared: [] });
  });
});

describe('spaceRowOwnsAccent', () => {
  const mine = space({ id: 'a' });
  const shared = space({ id: 'b', shared: true });

  it('hands the accent to the row for the open space', () => {
    expect(spaceRowOwnsAccent('/space/a', [mine, shared])).toBe(true);
    expect(spaceRowOwnsAccent('/space/b', [mine, shared])).toBe(true);
  });

  it('hands it to the default space at /space, which resolves there', () => {
    expect(spaceRowOwnsAccent('/space', [mine, shared])).toBe(true);
  });

  it('keeps it on the nav item when no row can claim it', () => {
    // Signed out, still loading, or shared-only: no unshared row to default to.
    expect(spaceRowOwnsAccent('/space', [])).toBe(false);
    expect(spaceRowOwnsAccent('/space', [shared])).toBe(false);
    // A space that is gone (trashed, or a stale deep link) must not leave the
    // rail with nothing highlighted.
    expect(spaceRowOwnsAccent('/space/missing', [mine])).toBe(false);
  });

  it('ignores paths outside the browser', () => {
    expect(spaceRowOwnsAccent('/', [mine])).toBe(false);
    expect(spaceRowOwnsAccent('/tutor/contexts', [mine])).toBe(false);
  });
});

describe('roleAtLeast', () => {
  it('ranks owner > editor > presenter', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('presenter', 'editor')).toBe(false);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
  });
});

describe('inviteEmailError', () => {
  it('accepts a normal email', () => {
    expect(inviteEmailError('teacher@school.ch', 'me@school.ch')).toBeNull();
  });
  it('rejects empty and malformed input', () => {
    expect(inviteEmailError('', null)).not.toBeNull();
    expect(inviteEmailError('not-an-email', null)).not.toBeNull();
  });
  it('rejects self-invites case-insensitively', () => {
    expect(inviteEmailError('Me@School.ch', 'me@school.ch')).not.toBeNull();
  });
});
