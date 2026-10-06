import { describe, expect, it } from 'vitest';

import { apply, env, expectError, liveSession, newSession, sessionWithOpen, participant, run } from './helpers.js';

/**
 * Revision discipline (LIVE-04): every APPLIED mutation bumps revision by exactly
 * 1. Documented no-ops return ok WITHOUT a bump, and are detected BEFORE
 * expectedRevision is checked (INT-06 retry safety). A stale expectedRevision on a
 * real mutation is rejected; an omitted expectedRevision always passes regardless
 * of the actual revision.
 */

describe('revision discipline — every applied mutation bumps by exactly 1', () => {
  it('session.start', () => {
    const before = newSession();
    const after = run(before, env({ command: 'session.start' }));
    expect(after.revision).toBe(before.revision + 1);
  });

  it('interaction.open / close / reveal each bump by 1', () => {
    let state = liveSession();
    const r0 = state.revision;
    state = run(state, env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(state.revision).toBe(r0 + 1);
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    expect(state.revision).toBe(r0 + 2);
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expect(state.revision).toBe(r0 + 3);
  });

  it('answer.submit bumps by 1 per applied ballot, including replacements', () => {
    let state = sessionWithOpen('mood');
    const r0 = state.revision;
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 2 } },
        participant('p1'),
      ),
    );
    expect(state.revision).toBe(r0 + 1);
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 4 } },
        participant('p1'),
      ),
    );
    expect(state.revision).toBe(r0 + 2);
  });

  it('qna.vote bumps by 1', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why?' } },
        participant('asker'),
      ),
    );
    const r0 = state.revision;
    state = run(
      state,
      env(
        { command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' },
        participant('voter'),
      ),
    );
    expect(state.revision).toBe(r0 + 1);
  });

  it('text.hide / text.unhide each bump by 1 when they actually change something', () => {
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'hi' } },
        participant('p1'),
      ),
    );
    const r0 = state.revision;
    state = run(state, env({ command: 'text.hide', interactionId: 'reflection', participantId: 'p1' }));
    expect(state.revision).toBe(r0 + 1);
    state = run(
      state,
      env({ command: 'text.unhide', interactionId: 'reflection', participantId: 'p1' }),
    );
    expect(state.revision).toBe(r0 + 2);
  });

  it('a whole session run has revision strictly equal to the count of applied (non-noop) commands', () => {
    let state = newSession();
    let expected = 0;
    const bump = (result: ReturnType<typeof apply>) => {
      if (!result.ok) throw new Error('expected ok');
      if (result.effects.length > 0) expected += 1;
      return result.state;
    };
    state = bump(apply(state, env({ command: 'session.start' })));
    state = bump(apply(state, env({ command: 'interaction.open', interactionId: 'mood' })));
    state = bump(apply(state, env({ command: 'interaction.close', interactionId: 'mood' })));
    state = bump(apply(state, env({ command: 'interaction.reveal', interactionId: 'mood' })));
    expect(state.revision).toBe(expected);
  });
});

describe('revision discipline — documented no-ops (ok, no bump, checked before expectedRevision)', () => {
  it('re-opening the already-active interaction: no-op, wrong expectedRevision still succeeds', () => {
    const state = sessionWithOpen('mood');
    const result = apply(
      state,
      env({ command: 'interaction.open', interactionId: 'mood' }, undefined, 99999),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }
  });

  it('re-revealing an already-revealed interaction: no-op, wrong expectedRevision still succeeds', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    const result = apply(
      state,
      env({ command: 'interaction.reveal', interactionId: 'mood' }, undefined, 99999),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }
  });

  it('freezing an already-frozen session: no-op, wrong expectedRevision still succeeds', () => {
    let state = run(liveSession(), env({ command: 'session.freeze' }));
    const result = apply(state, env({ command: 'session.freeze' }, undefined, 99999));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }
  });

  it('unfreezing a session that is not frozen: no-op, wrong expectedRevision still succeeds', () => {
    const state = liveSession();
    expect(state.frozen).toBe(false);
    const result = apply(state, env({ command: 'session.unfreeze' }, undefined, 99999));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }
  });

  it('text.hide when already hidden in the requested state is a no-op (but NOT one of the four documented pre-revision no-ops)', () => {
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'bullshit' } },
        participant('p1'),
      ),
    );
    // blocklisted text starts hidden already
    expect(state.interactions['reflection']?.ballots['p1']).toMatchObject({ hidden: true });

    // With the correct expectedRevision, re-hiding is a genuine no-op: ok, no bump.
    const result = apply(
      state,
      env(
        { command: 'text.hide', interactionId: 'reflection', participantId: 'p1' },
        undefined,
        state.revision,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }

    // CONTRACTS.md documents exactly four no-ops that are checked BEFORE
    // expectedRevision (re-open active, re-reveal, freeze-when-frozen,
    // unfreeze-when-not). text.hide is not among them, so a stale
    // expectedRevision still yields E_REVISION_CONFLICT even though the command
    // would otherwise be a no-op.
    const staleResult = apply(
      state,
      env(
        { command: 'text.hide', interactionId: 'reflection', participantId: 'p1' },
        undefined,
        state.revision + 999,
      ),
    );
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) expect(staleResult.error.code).toBe('E_REVISION_CONFLICT');
  });
});

describe('revision discipline — expectedRevision semantics', () => {
  it('a stale expectedRevision on a REAL mutation -> E_REVISION_CONFLICT', () => {
    const state = liveSession();
    expectError(
      state,
      env({ command: 'interaction.open', interactionId: 'mood' }, undefined, state.revision + 5),
      'E_REVISION_CONFLICT',
    );
  });

  it('the correct expectedRevision succeeds', () => {
    const state = liveSession();
    const result = apply(
      state,
      env({ command: 'interaction.open', interactionId: 'mood' }, undefined, state.revision),
    );
    expect(result.ok).toBe(true);
  });

  it('omitting expectedRevision always passes regardless of actual revision', () => {
    const state = liveSession();
    const result = apply(state, env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(result.ok).toBe(true);
  });

  it('expectedRevision: 0 against a fresh session (revision 0) succeeds', () => {
    const state = newSession();
    expect(state.revision).toBe(0);
    const result = apply(state, env({ command: 'session.start' }, undefined, 0));
    expect(result.ok).toBe(true);
  });
});
