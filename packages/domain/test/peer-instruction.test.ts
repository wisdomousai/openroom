import { describe, expect, it } from 'vitest';

import { applyCommand } from '../src/apply-command.js';
import { purgeBallots } from '../src/purge.js';
import { hostSnapshot, participantSnapshot, stageSnapshot } from '../src/snapshots.js';
import type { Aggregate, SessionState } from '../src/types.js';
import { apply, env, expectError, host, sessionWithOpen, participant, run } from './helpers.js';

/** Round-1 vote: two participants pick the wrong answer, one picks the right one. */
function afterRound1(): SessionState {
  let state = sessionWithOpen('pi-vote');
  const votes: [string, string][] = [
    ['p1', 'wrong'],
    ['p2', 'wrong'],
    ['p3', 'right'],
  ];
  for (const [id, optionId] of votes) {
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'pi-vote',
          answer: { kind: 'choice', optionIds: [optionId] },
        },
        participant(id),
      ),
    );
  }
  return run(state, env({ command: 'interaction.close', interactionId: 'pi-vote' }));
}

function revote(state: SessionState): SessionState {
  return run(state, env({ command: 'interaction.revote', interactionId: 'pi-vote' }));
}

function choiceCounts(aggregate: Aggregate | null | undefined): Record<string, number> {
  if (!aggregate || aggregate.kind !== 'choice') throw new Error('expected a choice aggregate');
  return aggregate.counts;
}

describe('interaction.revote — lifecycle', () => {
  it('a peer-instruction interaction starts in round 1', () => {
    expect(sessionWithOpen('pi-vote').interactions['pi-vote']?.round).toBe(1);
  });

  it('a plain interaction has no round at all', () => {
    expect(sessionWithOpen('single-choice').interactions['single-choice']?.round).toBeUndefined();
  });

  it('archives round 1, resets the ballots, reopens in round 2 and bumps the revision', () => {
    const closed = afterRound1();
    const result = apply(closed, env({ command: 'interaction.revote', interactionId: 'pi-vote' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const runtime = result.state.interactions['pi-vote']!;
    expect(runtime.status).toBe('open');
    expect(runtime.round).toBe(2);
    expect(runtime.ballots).toEqual({});
    expect(choiceCounts(runtime.aggregate)).toEqual({ right: 0, wrong: 0 });
    expect(runtime.aggregate).toMatchObject({ total: 0, dontKnow: 0 });

    expect(Object.keys(runtime.round1!.ballots).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(choiceCounts(runtime.round1!.aggregate)).toEqual({ right: 1, wrong: 2 });

    expect(result.revision).toBe(closed.revision + 1);
    expect(result.effects).toEqual([{ type: 'notify' }]);
    expect(result.state.activeInteractionId).toBe('pi-vote');
  });

  it('round 2 collects a fresh tally that does not touch the archive', () => {
    let state = revote(afterRound1());
    for (const id of ['p1', 'p2', 'p3']) {
      state = run(
        state,
        env(
          {
            command: 'answer.submit',
            interactionId: 'pi-vote',
            answer: { kind: 'choice', optionIds: ['right'] },
          },
          participant(id),
        ),
      );
    }
    const runtime = state.interactions['pi-vote']!;
    expect(choiceCounts(runtime.aggregate)).toEqual({ right: 3, wrong: 0 });
    expect(choiceCounts(runtime.round1!.aggregate)).toEqual({ right: 1, wrong: 2 });
  });

  it('a repeated revote is a no-op success: no revision bump, archive untouched', () => {
    const round2 = revote(afterRound1());
    const retry = apply(round2, env({ command: 'interaction.revote', interactionId: 'pi-vote' }));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.revision).toBe(round2.revision);
    expect(retry.effects).toEqual([]);
    expect(retry.state).toBe(round2);
  });

  it('the no-op is checked BEFORE expectedRevision (retry safety)', () => {
    const round2 = revote(afterRound1());
    const stale = applyCommand(
      round2,
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }, host(), round2.revision - 5),
      1000,
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.revision).toBe(round2.revision);
  });

  it('a retried revote after round 2 was closed is still a no-op', () => {
    const closedAgain = run(
      revote(afterRound1()),
      env({ command: 'interaction.close', interactionId: 'pi-vote' }),
    );
    const retry = apply(
      closedAgain,
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }),
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.revision).toBe(closedAgain.revision);
    expect(retry.state.interactions['pi-vote']?.status).toBe('closed');
  });

  it('E_INVALID_TRANSITION: the interaction is still open', () => {
    expectError(
      sessionWithOpen('pi-vote'),
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('E_INVALID_TRANSITION: the interaction never opened', () => {
    expectError(
      sessionWithOpen('mood'),
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('E_INVALID_TRANSITION: the interaction was already revealed', () => {
    const revealed = run(
      afterRound1(),
      env({ command: 'interaction.reveal', interactionId: 'pi-vote' }),
    );
    expectError(
      revealed,
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('E_INVALID_TRANSITION: not a peer-instruction interaction', () => {
    const closed = run(
      sessionWithOpen('single-choice'),
      env({ command: 'interaction.close', interactionId: 'single-choice' }),
    );
    expectError(
      closed,
      env({ command: 'interaction.revote', interactionId: 'single-choice' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('E_UNKNOWN_INTERACTION: no such interaction', () => {
    expectError(
      afterRound1(),
      env({ command: 'interaction.revote', interactionId: 'nope' }),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('E_FORBIDDEN: a participant may not start a revote', () => {
    expectError(
      afterRound1(),
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }, participant('p1')),
      'E_FORBIDDEN',
    );
  });

  it('E_FORBIDDEN: the stage may not start a revote', () => {
    expectError(
      afterRound1(),
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }, { role: 'stage' }),
      'E_FORBIDDEN',
    );
  });

  it('E_ENDED: no revote once the session has ended', () => {
    const ended = run(afterRound1(), env({ command: 'session.end' }));
    expectError(
      ended,
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }),
      'E_ENDED',
    );
  });

  it('E_REVISION_CONFLICT: a stale expectedRevision on a genuine (round 1) revote', () => {
    const closed = afterRound1();
    const result = applyCommand(
      closed,
      env({ command: 'interaction.revote', interactionId: 'pi-vote' }, host(), closed.revision - 1),
      1000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('E_REVISION_CONFLICT');
  });

  it('does not mutate the input state', () => {
    const closed = afterRound1();
    const before = structuredClone(closed);
    revote(closed);
    expect(closed).toEqual(before);
  });

  it('a revote closes whatever else was open', () => {
    const closed = afterRound1();
    const other = run(closed, env({ command: 'interaction.open', interactionId: 'mood' }));
    const after = revote(other);
    expect(after.interactions['mood']?.status).toBe('closed');
    expect(after.activeInteractionId).toBe('pi-vote');
  });
});

describe('interaction.undoRevote — back to round 1', () => {
  function undo(state: SessionState): SessionState {
    return run(state, env({ command: 'interaction.undoRevote', interactionId: 'pi-vote' }));
  }

  it('restores the round-1 ballots and tally, closed, with no archive left', () => {
    const r2 = revote(afterRound1());
    // Round 2 gets some votes that must be discarded on undo.
    let dirtied = r2;
    for (const id of ['p1', 'p2']) {
      dirtied = run(
        dirtied,
        env(
          {
            command: 'answer.submit',
            interactionId: 'pi-vote',
            answer: { kind: 'choice', optionIds: ['right'] },
          },
          participant(id),
        ),
      );
    }
    expect(choiceCounts(dirtied.interactions['pi-vote']!.aggregate)).toEqual({ right: 2, wrong: 0 });

    const restored = undo(dirtied);
    const runtime = restored.interactions['pi-vote']!;
    expect(runtime.status).toBe('closed');
    expect(runtime.round).toBe(1);
    expect(runtime.round1).toBeUndefined();
    expect(choiceCounts(runtime.aggregate)).toEqual({ right: 1, wrong: 2 });
    expect(Object.keys(runtime.ballots).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(restored.activeInteractionId).toBe('pi-vote');
  });

  it('works after a reveal in round 2 (host can still bail out)', () => {
    let state = revote(afterRound1());
    state = run(state, env({ command: 'interaction.close', interactionId: 'pi-vote' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'pi-vote' }));
    const restored = undo(state);
    expect(restored.interactions['pi-vote']?.status).toBe('closed');
    expect(restored.interactions['pi-vote']?.round).toBe(1);
    expect(choiceCounts(restored.interactions['pi-vote']!.aggregate)).toEqual({
      right: 1,
      wrong: 2,
    });
  });

  it('a repeated undo is a no-op success', () => {
    const once = undo(revote(afterRound1()));
    const again = apply(once, env({ command: 'interaction.undoRevote', interactionId: 'pi-vote' }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.revision).toBe(once.revision);
    expect(again.effects).toEqual([]);
  });

  it('after undo, the host can revote again', () => {
    const restored = undo(revote(afterRound1()));
    const again = revote(restored);
    expect(again.interactions['pi-vote']?.round).toBe(2);
    expect(choiceCounts(again.interactions['pi-vote']!.round1!.aggregate)).toEqual({
      right: 1,
      wrong: 2,
    });
  });

  it('E_FORBIDDEN for a participant', () => {
    expectError(
      revote(afterRound1()),
      env({ command: 'interaction.undoRevote', interactionId: 'pi-vote' }, participant('p1')),
      'E_FORBIDDEN',
    );
  });
});

/**
 * Anti-anchoring (the whole point of peer instruction): while round 2 is being
 * voted on, nobody in the session may see how round 1 went. These tests are
 * written adversarially — the round-1 aggregate carries a sentinel that must
 * not appear anywhere in the serialized participant/stage snapshot.
 */
describe('interaction.revote — anti-anchoring snapshot gating', () => {
  const SENTINEL = 4242;

  /** Round 2 in progress, with a recognisable round-1 tally. */
  function round2InProgress(): SessionState {
    const state = revote(afterRound1());
    const runtime = state.interactions['pi-vote']!;
    const archive = runtime.round1!;
    if (archive.aggregate.kind !== 'choice') throw new Error('expected a choice aggregate');
    return {
      ...state,
      interactions: {
        ...state.interactions,
        'pi-vote': {
          ...runtime,
          round1: {
            ...archive,
            aggregate: { ...archive.aggregate, counts: { right: SENTINEL, wrong: SENTINEL } },
          },
        },
      },
    };
  }

  it('the participant snapshot hides the round-1 tally during round 2', () => {
    const snapshot = participantSnapshot(round2InProgress(), 'p1');
    expect(snapshot.round).toBe(2);
    expect(snapshot.round1Aggregate).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(String(SENTINEL));
  });

  it('the stage snapshot hides the round-1 tally during round 2', () => {
    const snapshot = stageSnapshot(round2InProgress());
    expect(snapshot.round).toBe(2);
    expect(snapshot.round1Aggregate).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(String(SENTINEL));
  });

  it('closing round 2 is still not a reveal: the tally stays hidden', () => {
    const closed = run(
      round2InProgress(),
      env({ command: 'interaction.close', interactionId: 'pi-vote' }),
    );
    expect(participantSnapshot(closed, 'p1').round1Aggregate).toBeNull();
    expect(stageSnapshot(closed).round1Aggregate).toBeNull();
    expect(JSON.stringify(stageSnapshot(closed))).not.toContain(String(SENTINEL));
  });

  it('the host sees both rounds immediately, reveal or not', () => {
    const snapshot = hostSnapshot(round2InProgress());
    const summary = snapshot.interactions.find((i) => i.id === 'pi-vote')!;
    expect(summary.round).toBe(2);
    expect(choiceCounts(summary.round1Aggregate)).toEqual({ right: SENTINEL, wrong: SENTINEL });
  });

  it('revealing releases the round-1 tally to participants and the stage', () => {
    const revealed = run(
      round2InProgress(),
      env({ command: 'interaction.reveal', interactionId: 'pi-vote' }),
    );
    expect(choiceCounts(participantSnapshot(revealed, 'p1').round1Aggregate)).toEqual({
      right: SENTINEL,
      wrong: SENTINEL,
    });
    expect(choiceCounts(stageSnapshot(revealed).round1Aggregate)).toEqual({
      right: SENTINEL,
      wrong: SENTINEL,
    });
  });

  it('a not-yet-revoted interaction advertises no round-1 archive at all', () => {
    const snapshot = participantSnapshot(afterRound1(), 'p1');
    expect(snapshot.round).toBe(1);
    expect('round1Aggregate' in snapshot).toBe(false);
    expect('ownRound1Answer' in snapshot).toBe(false);
  });

  it('an interaction without peer instruction has no round in any snapshot', () => {
    const state = sessionWithOpen('single-choice');
    expect(participantSnapshot(state, 'p1').round).toBeUndefined();
    expect(stageSnapshot(state).round).toBeUndefined();
  });

  it('the participant gets their OWN round-1 answer back, and only their own', () => {
    const state = round2InProgress();
    expect(participantSnapshot(state, 'p1').ownRound1Answer).toEqual({
      kind: 'choice',
      optionIds: ['wrong'],
    });
    expect(participantSnapshot(state, 'p3').ownRound1Answer).toEqual({
      kind: 'choice',
      optionIds: ['right'],
    });
    // Someone who did not vote in round 1 gets null, not a stranger's ballot.
    expect(participantSnapshot(state, 'p9').ownRound1Answer).toBeNull();
  });

  it('the answered flag resets for round 2', () => {
    const state = round2InProgress();
    const before = participantSnapshot(state, 'p1');
    expect(before.answered).toBe(false);
    expect(before.yourAnswer).toBeNull();

    const voted = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'pi-vote',
          answer: { kind: 'choice', optionIds: ['right'] },
        },
        participant('p1'),
      ),
    );
    const after = participantSnapshot(voted, 'p1');
    expect(after.answered).toBe(true);
    expect(after.yourAnswer).toEqual({ kind: 'choice', optionIds: ['right'] });
    // …and the round-1 recall survives the new vote.
    expect(after.ownRound1Answer).toEqual({ kind: 'choice', optionIds: ['wrong'] });
  });
});

describe('purgeBallots with peer-instruction rounds', () => {
  function endedRound2(): SessionState {
    let state = revote(afterRound1());
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'pi-vote',
          answer: { kind: 'choice', optionIds: ['right'] },
        },
        participant('p1'),
      ),
    );
    return run(state, env({ command: 'session.end' }));
  }

  it('drops the round-1 ballots and keeps the round-1 aggregate', () => {
    const purged = purgeBallots(endedRound2(), 5_000);
    const runtime = purged.interactions['pi-vote']!;
    expect(runtime.ballots).toEqual({});
    expect(runtime.round1?.ballots).toEqual({});
    expect(choiceCounts(runtime.round1?.aggregate)).toEqual({ right: 1, wrong: 2 });
    expect(runtime.round).toBe(2);
    expect(purged.purgedAt).toBe(5_000);
  });

  it('no participant id survives anywhere in the purged session', () => {
    const serialized = JSON.stringify(purgeBallots(endedRound2(), 5_000));
    for (const id of ['p1', 'p2', 'p3']) {
      expect(serialized).not.toContain(`"${id}"`);
    }
  });

  it('anonymizes round-1 text entries the same way as live ones', () => {
    // A text interaction alongside the PI vote: both layers must be scrubbed.
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'hello' } },
        participant('p7'),
      ),
    );
    state = run(state, env({ command: 'session.end' }));
    const purged = purgeBallots(state, 1);
    const aggregate = purged.interactions['reflection']!.aggregate;
    if (aggregate.kind !== 'text') throw new Error('expected text');
    expect(aggregate.entries[0]).toEqual({ participantId: 'purged-1', text: 'hello', hidden: false });
  });

  it('stays idempotent with rounds present', () => {
    const once = purgeBallots(endedRound2(), 5_000);
    expect(purgeBallots(once, 6_000)).toBe(once);
  });
});
