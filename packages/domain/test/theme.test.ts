import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { createSession } from '../src/create-session.js';
import { hostSnapshot, participantSnapshot, stageSnapshot } from '../src/snapshots.js';
import { isKnownTheme, SESSION_THEME_IDS, type SessionState } from '../src/types.js';
import { env, expectError, fixtureSpec, host, newSession, participant, run } from './helpers.js';

/**
 * Live theming (`session.theme`). The theme is session state, not session-document state:
 * the session document seeds it, the host switches it mid-session and every snapshot carries it
 * so participant, stage and console restyle from the same revision.
 */

function themed(theme: string): SessionState {
  return createSession(
    { ...fixtureSpec, defaults: { theme: theme as never } },
    'SESSTEST',
    0,
  );
}

describe('session theme initialization', () => {
  it("defaults to 'default' when the session says nothing", () => {
    expect(newSession().theme).toBe('default');
  });

  it('is seeded from the session `defaults.theme`', () => {
    for (const theme of SESSION_THEME_IDS) {
      expect(themed(theme).theme).toBe(theme);
    }
  });

  it('isKnownTheme accepts exactly the five ids', () => {
    for (const theme of SESSION_THEME_IDS) expect(isKnownTheme(theme)).toBe(true);
    expect(isKnownTheme('neon')).toBe(false);
    expect(isKnownTheme('')).toBe(false);
    expect(isKnownTheme(undefined)).toBe(false);
    expect(isKnownTheme(7)).toBe(false);
  });
});

describe('session.theme command', () => {
  it('switches the theme and bumps the revision', () => {
    const state = newSession();
    const next = run(state, env({ command: 'session.theme', theme: 'chalkboard' }));
    expect(next.theme).toBe('chalkboard');
    expect(next.revision).toBe(state.revision + 1);
  });

  it('works in lobby and while live', () => {
    let state = newSession();
    state = run(state, env({ command: 'session.theme', theme: 'paper' }));
    state = run(state, env({ command: 'session.start' }));
    state = run(state, env({ command: 'session.theme', theme: 'projector' }));
    expect(state.theme).toBe('projector');
  });

  it('accepts every built-in id', () => {
    let state = newSession();
    for (const theme of SESSION_THEME_IDS) {
      if (theme === state.theme) continue;
      state = run(state, env({ command: 'session.theme', theme }));
      expect(state.theme).toBe(theme);
    }
  });

  it('rejects an unknown theme with E_INVALID_THEME and leaves the state alone', () => {
    const state = run(newSession(), env({ command: 'session.theme', theme: 'sherbet' }));
    for (const bogus of ['neon', 'Sherbet', '', 'default ']) {
      expectError(state, env({ command: 'session.theme', theme: bogus }), 'E_INVALID_THEME');
    }
    expect(state.theme).toBe('sherbet');
  });

  it('is host-only', () => {
    const state = newSession();
    expectError(
      state,
      env({ command: 'session.theme', theme: 'paper' }, participant('p1')),
      'E_FORBIDDEN',
    );
    expectError(
      state,
      env({ command: 'session.theme', theme: 'paper' }, { role: 'stage' }),
      'E_FORBIDDEN',
    );
  });

  it('is rejected once the session has ended', () => {
    const ended = run(newSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.theme', theme: 'paper' }), 'E_ENDED');
  });
});

describe('session.theme idempotency', () => {
  it('re-setting the same theme is a no-op: no revision bump, no effects', () => {
    const state = run(newSession(), env({ command: 'session.theme', theme: 'paper' }));
    const result = applyCommand(state, env({ command: 'session.theme', theme: 'paper' }), 2000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(state.revision);
    expect(result.effects).toEqual([]);
    expect(result.state).toBe(state);
  });

  it('the no-op is checked BEFORE expectedRevision, so a retry never conflicts', () => {
    const state = run(newSession(), env({ command: 'session.theme', theme: 'paper' }));
    // A stale expectedRevision from the first attempt must still succeed.
    const result = applyCommand(
      state,
      env({ command: 'session.theme', theme: 'paper' }, host(), state.revision - 1),
      2000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(state.revision);
  });

  it('a stale expectedRevision on a REAL change still conflicts', () => {
    const state = run(newSession(), env({ command: 'session.theme', theme: 'paper' }));
    expectError(
      state,
      env({ command: 'session.theme', theme: 'sherbet' }, host(), state.revision - 1),
      'E_REVISION_CONFLICT',
    );
  });

  it('a no-op on a session that has ended is still E_ENDED', () => {
    let state = run(newSession(), env({ command: 'session.theme', theme: 'paper' }));
    state = run(state, env({ command: 'session.end' }));
    expectError(state, env({ command: 'session.theme', theme: 'paper' }), 'E_ENDED');
  });
});

describe('theme in snapshots', () => {
  it('all three snapshots expose the current theme', () => {
    const state = run(newSession(), env({ command: 'session.theme', theme: 'chalkboard' }));
    expect(participantSnapshot(state, 'p1').theme).toBe('chalkboard');
    expect(stageSnapshot(state).theme).toBe('chalkboard');
    expect(hostSnapshot(state).theme).toBe('chalkboard');
  });

  it('the seeded session theme shows up before any command', () => {
    const state = themed('projector');
    expect(participantSnapshot(state, 'p1').theme).toBe('projector');
    expect(stageSnapshot(state).theme).toBe('projector');
    expect(hostSnapshot(state).theme).toBe('projector');
  });

  it('a switch is visible to every role at the same revision', () => {
    const before = newSession();
    const after = run(before, env({ command: 'session.theme', theme: 'sherbet' }));
    const revision = after.revision;
    expect(participantSnapshot(after, 'p1').revision).toBe(revision);
    expect(stageSnapshot(after).revision).toBe(revision);
    expect(hostSnapshot(after).revision).toBe(revision);
    expect(participantSnapshot(before, 'p1').theme).toBe('default');
  });
});
