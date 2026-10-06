import { describe, expect, it } from 'vitest';

import type { Session } from '@openroom/schema';

import {
  hostSnapshot,
  participantSnapshot,
  purgeBallots,
  sortedQuestions,
  stageSnapshot,
} from '../src/index.js';
import type { SessionState } from '../src/types.js';
import { apply, env, expectError, fixtureSpec, host, newSession, participant, run } from './helpers.js';

/**
 * Session-wide audience Q&A (SessionState.qna): open for the whole session,
 * independent of the active interaction. Many questions per participant,
 * one upvote per participant per question, host hide/unhide + stage placement.
 */

const qnaSession: Session = { ...fixtureSpec, qna: { enabled: true } };

function qnaRoom(): SessionState {
  return run(newSession(qnaSession), env({ command: 'session.start' }));
}

function ask(state: SessionState, who: string, id: string, text: string, now = 1000): SessionState {
  return run(state, env({ command: 'qna.ask', questionId: id, text }, participant(who)), now);
}

function upvote(state: SessionState, who: string, id: string, now = 1000): SessionState {
  return run(state, env({ command: 'qna.upvote', questionId: id }, participant(who)), now);
}

describe('session qna — enablement and lifecycle', () => {
  it('every qna command fails E_FORBIDDEN when the session does not enable it', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: 'hi' }, participant('p1')),
      'E_FORBIDDEN',
    );
    expectError(
      state,
      env({ command: 'qna.upvote', questionId: 'q1' }, participant('p1')),
      'E_FORBIDDEN',
    );
    expectError(state, env({ command: 'qna.stage', mode: 'list' }), 'E_FORBIDDEN');
  });

  it('asking works in the lobby, before the session starts', () => {
    const state = ask(newSession(qnaSession), 'p1', 'q1', 'early bird question');
    expect(state.qna.questions['q1']?.text).toBe('early bird question');
  });

  it('asking works while a different interaction is open (session-wide, not block-scoped)', () => {
    const open = run(qnaRoom(), env({ command: 'interaction.open', interactionId: 'mood' }));
    const state = ask(open, 'p1', 'q1', 'unrelated to the poll');
    expect(state.qna.questions['q1']).toBeDefined();
    expect(state.activeInteractionId).toBe('mood');
    expect(state.interactions['mood']?.status).toBe('open');
  });

  it('participant commands require a participant actor; moderation is host-only', () => {
    const state = ask(qnaRoom(), 'p1', 'q1', 'hello');
    expectError(state, env({ command: 'qna.ask', questionId: 'q2', text: 'x' }, host()), 'E_FORBIDDEN');
    expectError(
      state,
      env({ command: 'qna.hide', questionId: 'q1' }, participant('p1')),
      'E_FORBIDDEN',
    );
  });

  it('frozen blocks ask/upvote; ended blocks everything', () => {
    const state = ask(qnaRoom(), 'p1', 'q1', 'hello');
    const frozen = run(state, env({ command: 'session.freeze' }));
    expectError(
      frozen,
      env({ command: 'qna.ask', questionId: 'q2', text: 'x' }, participant('p1')),
      'E_FROZEN',
    );
    expectError(
      frozen,
      env({ command: 'qna.upvote', questionId: 'q1' }, participant('p2')),
      'E_FROZEN',
    );
    const ended = run(state, env({ command: 'session.end' }));
    expectError(
      ended,
      env({ command: 'qna.ask', questionId: 'q2', text: 'x' }, participant('p1')),
      'E_ENDED',
    );
  });
});

describe('session qna — ask semantics', () => {
  it('a participant can ask many questions', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'first');
    state = ask(state, 'p1', 'q2', 'second');
    expect(Object.keys(state.qna.questions)).toHaveLength(2);
  });

  it('re-asking the identical question is an idempotent no-op (no revision bump)', () => {
    const state = ask(qnaRoom(), 'p1', 'q1', 'same text');
    const retry = apply(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: 'same text' }, participant('p1')),
    );
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.revision).toBe(state.revision);
      expect(retry.effects).toHaveLength(0);
    }
  });

  it('editing your own question keeps its votes and createdAt', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'v1', 500);
    state = upvote(state, 'p2', 'q1');
    state = ask(state, 'p1', 'q1', 'v2', 2000);
    const question = state.qna.questions['q1'];
    expect(question?.text).toBe('v2');
    expect(question?.votes).toBe(1);
    expect(question?.voters).toEqual(['p2']);
    expect(question?.createdAt).toBe(500);
  });

  it("using someone else's question id is E_FORBIDDEN", () => {
    const state = ask(qnaRoom(), 'p1', 'q1', 'mine');
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: 'takeover' }, participant('p2')),
      'E_FORBIDDEN',
    );
  });

  it('rejects empty, overlong, and bad-id questions', () => {
    const state = qnaRoom();
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: '   ' }, participant('p1')),
      'E_INVALID_ANSWER',
    );
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: 'x'.repeat(301) }, participant('p1')),
      'E_INVALID_ANSWER',
    );
    expectError(
      state,
      env({ command: 'qna.ask', questionId: '', text: 'ok' }, participant('p1')),
      'E_INVALID_ANSWER',
    );
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'x'.repeat(65), text: 'ok' }, participant('p1')),
      'E_INVALID_ANSWER',
    );
  });

  it('honors a session-level maxLength override', () => {
    const shortSession: Session = { ...fixtureSpec, qna: { enabled: true, maxLength: 10 } };
    const state = run(newSession(shortSession), env({ command: 'session.start' }));
    expectError(
      state,
      env({ command: 'qna.ask', questionId: 'q1', text: 'this is far too long' }, participant('p1')),
      'E_INVALID_ANSWER',
    );
    expect(ask(state, 'p1', 'q1', 'short').qna.questions['q1']).toBeDefined();
  });

  it('blocklisted questions arrive hidden', () => {
    const state = ask(qnaRoom(), 'p1', 'q1', 'this is fucking rude');
    expect(state.qna.questions['q1']?.hidden).toBe(true);
  });
});

describe('session qna — upvotes', () => {
  it('one upvote per participant per question; repeat is E_FORBIDDEN', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'popular');
    state = upvote(state, 'p2', 'q1');
    state = upvote(state, 'p3', 'q1');
    expect(state.qna.questions['q1']?.votes).toBe(2);
    expectError(
      state,
      env({ command: 'qna.upvote', questionId: 'q1' }, participant('p2')),
      'E_FORBIDDEN',
    );
  });

  it('unknown question id is E_INVALID_ANSWER', () => {
    expectError(
      qnaRoom(),
      env({ command: 'qna.upvote', questionId: 'nope' }, participant('p1')),
      'E_INVALID_ANSWER',
    );
  });

  it('sortedQuestions orders by votes desc, then createdAt asc, then id', () => {
    let state = ask(qnaRoom(), 'p1', 'q-b', 'older', 100);
    state = ask(state, 'p1', 'q-a', 'newer', 200);
    state = ask(state, 'p2', 'q-c', 'voted', 300);
    state = upvote(state, 'p1', 'q-c');
    expect(sortedQuestions(state.qna).map((q) => q.id)).toEqual(['q-c', 'q-b', 'q-a']);
  });
});

describe('session qna — moderation and stage placement', () => {
  it('hide/unhide flips visibility; retries are no-ops', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'hello');
    state = run(state, env({ command: 'qna.hide', questionId: 'q1' }));
    expect(state.qna.questions['q1']?.hidden).toBe(true);
    const retry = apply(state, env({ command: 'qna.hide', questionId: 'q1' }));
    expect(retry.ok && retry.revision === state.revision).toBe(true);
    state = run(state, env({ command: 'qna.unhide', questionId: 'q1' }));
    expect(state.qna.questions['q1']?.hidden).toBe(false);
  });

  it('stage list/off toggles; identical placement is a no-op', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'hello');
    state = run(state, env({ command: 'qna.stage', mode: 'list' }));
    expect(state.qna.stage).toEqual({ mode: 'list' });
    const retry = apply(state, env({ command: 'qna.stage', mode: 'list' }));
    expect(retry.ok && retry.revision === state.revision).toBe(true);
    state = run(state, env({ command: 'qna.stage', mode: 'off' }));
    expect(state.qna.stage).toEqual({ mode: 'off' });
  });

  it('spotlight requires a visible question and falls back to list when it is hidden', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'hello');
    expectError(state, env({ command: 'qna.stage', mode: 'spotlight' }), 'E_INVALID_ANSWER');
    expectError(
      state,
      env({ command: 'qna.stage', mode: 'spotlight', questionId: 'nope' }),
      'E_INVALID_ANSWER',
    );
    state = run(state, env({ command: 'qna.stage', mode: 'spotlight', questionId: 'q1' }));
    expect(state.qna.stage).toEqual({ mode: 'spotlight', questionId: 'q1' });
    state = run(state, env({ command: 'qna.hide', questionId: 'q1' }));
    expect(state.qna.stage).toEqual({ mode: 'list' });
    expectError(
      state,
      env({ command: 'qna.stage', mode: 'spotlight', questionId: 'q1' }),
      'E_INVALID_ANSWER',
    );
  });
});

describe('session qna — snapshots', () => {
  function snapshotFixture(): SessionState {
    let state = ask(qnaRoom(), 'p1', 'q1', 'visible question', 100);
    state = ask(state, 'p2', 'q2', 'hidden question', 200);
    state = upvote(state, 'p2', 'q1');
    return run(state, env({ command: 'qna.hide', questionId: 'q2' }));
  }

  it('participant sees visible questions plus their own hidden one; voters never leak', () => {
    const state = snapshotFixture();
    const p2 = participantSnapshot(state, 'p2');
    expect(p2.qna?.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    const own = p2.qna?.questions.find((q) => q.id === 'q2');
    expect(own).toMatchObject({ own: true, hidden: true });
    const voted = p2.qna?.questions.find((q) => q.id === 'q1');
    expect(voted).toMatchObject({ votedByYou: true, own: false, votes: 1 });
    const p3 = participantSnapshot(state, 'p3');
    expect(p3.qna?.questions.map((q) => q.id)).toEqual(['q1']);
    expect(JSON.stringify(p3)).not.toContain('voters');
    expect(JSON.stringify(p3.qna)).not.toContain('p1');
  });

  it('stage sees visible questions only, with placement and no participant ids', () => {
    const state = run(snapshotFixture(), env({ command: 'qna.stage', mode: 'list' }));
    const stage = stageSnapshot(state);
    expect(stage.qna?.stage).toEqual({ mode: 'list' });
    expect(stage.qna?.questions).toEqual([
      { id: 'q1', text: 'visible question', votes: 1 },
    ]);
    expect(JSON.stringify(stage)).not.toContain('voters');
  });

  it('host sees everything except voter ledgers', () => {
    const state = snapshotFixture();
    const snapshot = hostSnapshot(state);
    expect(snapshot.qna.enabled).toBe(true);
    expect(snapshot.qna.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(snapshot.qna.questions[0]).toMatchObject({ participantId: 'p1', votes: 1 });
    expect(JSON.stringify(snapshot.qna)).not.toContain('voters');
  });

  it('frozen empties participant and stage question lists but not the host view', () => {
    const state = run(snapshotFixture(), env({ command: 'session.freeze' }));
    expect(participantSnapshot(state, 'p1').qna?.questions).toEqual([]);
    expect(stageSnapshot(state).qna?.questions).toEqual([]);
    expect(hostSnapshot(state).qna.questions).toHaveLength(2);
  });

  it('attributes questions with the asker handle in pseudonymous sessions, on participant and stage views', () => {
    const base = snapshotFixture();
    const state: SessionState = {
      ...base,
      participants: {
        ...base.participants,
        p1: { ...(base.participants['p1'] ?? { joinedAt: 0 }), handle: 'Cedar Badger 4415' },
      },
    };
    const peer = participantSnapshot(state, 'p3');
    expect(peer.qna?.questions[0]).toMatchObject({ id: 'q1', handle: 'Cedar Badger 4415' });
    const staged = stageSnapshot(run(state, env({ command: 'qna.stage', mode: 'list' })));
    expect(staged.qna?.questions[0]).toMatchObject({ id: 'q1', handle: 'Cedar Badger 4415' });
    // Anonymous sessions (no handle on the participant record) omit the field.
    const anon = participantSnapshot(base, 'p3');
    expect(anon.qna?.questions[0]).not.toHaveProperty('handle');
  });

  it('qna is absent from participant/stage snapshots when the session disables it', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    expect(participantSnapshot(state, 'p1').qna).toBeUndefined();
    expect(stageSnapshot(state).qna).toBeUndefined();
    expect(hostSnapshot(state).qna.enabled).toBe(false);
  });
});

describe('session qna — purge and back-compat', () => {
  it('purge anonymizes askers and empties voter ledgers, keeping text/votes', () => {
    let state = ask(qnaRoom(), 'p1', 'q1', 'keep me', 100);
    state = upvote(state, 'p2', 'q1');
    state = run(state, env({ command: 'session.end' }));
    const purged = purgeBallots(state, 9999);
    const question = purged.qna.questions['q1'];
    expect(question).toMatchObject({ text: 'keep me', votes: 1, voters: [] });
    expect(question?.participantId).toBe('purged-1');
  });

  it('session states stored before the qna region existed still apply commands and snapshot', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    const legacy = { ...state } as Partial<SessionState> as SessionState;
    delete (legacy as Partial<SessionState>).qna;
    const result = apply(
      legacy,
      env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1')),
    );
    // mood is not open, so this fails cleanly — the point is no crash on missing qna.
    expect(result.ok).toBe(false);
    expect(participantSnapshot(legacy, 'p1').qna).toBeUndefined();
    expect(hostSnapshot(legacy).qna.enabled).toBe(false);
    expect(stageSnapshot(legacy).qna).toBeUndefined();
  });
});
