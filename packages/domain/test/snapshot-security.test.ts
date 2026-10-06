import type { Session } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { createSession, hostSnapshot, participantSnapshot, stageSnapshot } from '../src/index.js';
import { env, participant, run } from './helpers.js';

/**
 * API-06 / DATA-03 — adversarial. A session with correct answers, notes, and
 * misconceptions must never leak them to participant/stage views pre-reveal, and
 * a hidden text entry must never surface on the stage even post-reveal or when
 * the session is frozen. Aggregate must be null pre-reveal for hidden-until-close,
 * but visible while open for a `live` interaction. We JSON.stringify entire
 * snapshots and assert sentinel strings are textually absent — not just "the
 * field we expect to be missing is missing" but "this string does not appear
 * ANYWHERE in the payload", which also catches leaks through unexpected fields.
 */

const SENTINEL_NOTES = 'SENTINEL_NOTES_DO_NOT_LEAK';
const SENTINEL_MISCONCEPTION = 'SENTINEL_MISCONCEPTION_DO_NOT_LEAK';
const SENTINEL_EXPLANATION = 'SENTINEL_EXPLANATION_DO_NOT_LEAK';
const SENTINEL_TEXT_HIDDEN = 'SENTINEL_HIDDEN_BULLSHIT_TEXT';

const session: Session = {
  version: 1,
  meta: { title: 'Security test session' },
  defaults: { resultVisibility: 'hidden-until-close' },
  interactions: [
    {
      id: 'quiz',
      type: 'choice',
      prompt: 'Pick the right one',
      notes: SENTINEL_NOTES,
      pedagogy: { explanation: SENTINEL_EXPLANATION },
      options: [
        { id: 'a', label: 'A', misconception: SENTINEL_MISCONCEPTION },
        { id: 'b', label: 'B', correct: true },
      ],
    },
    {
      id: 'live-choice',
      type: 'choice',
      prompt: 'Live visibility check',
      resultVisibility: 'live',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    {
      id: 'guess',
      type: 'numeric',
      prompt: 'Estimate',
      correct: 50,
      tolerance: 10,
      notes: SENTINEL_NOTES,
    },
    {
      id: 'chat',
      type: 'text',
      prompt: 'Say something',
    },
  ],
};

function newSession(): ReturnType<typeof createSession> {
  return createSession(session, 'SECROOM1', 0);
}

const SENTINELS = [SENTINEL_NOTES, SENTINEL_MISCONCEPTION, SENTINEL_EXPLANATION];

describe('snapshot security — pre-reveal, hidden-until-close', () => {
  it('participantSnapshot never contains notes/misconception/explanation before reveal', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'quiz' }));
    const snap = participantSnapshot(state, 'p1');
    const serialized = JSON.stringify(snap);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('"correct"');
    expect(serialized).not.toContain('"tolerance"');
  });

  it('stageSnapshot never contains notes/misconception/explanation before reveal', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'quiz' }));
    const snap = stageSnapshot(state);
    const serialized = JSON.stringify(snap);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('"correct"');
    expect(serialized).not.toContain('"tolerance"');
  });

  it('numeric interaction: correct value and tolerance absent from participant/stage pre-reveal', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'guess' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: 5 } },
        participant('p1'),
      ),
    );
    const p = JSON.stringify(participantSnapshot(state, 'p1'));
    const s = JSON.stringify(stageSnapshot(state));
    for (const payload of [p, s]) {
      expect(payload).not.toContain(SENTINEL_NOTES);
      expect(payload).not.toContain('"correct"');
      expect(payload).not.toContain('"tolerance"');
      // the actual secret numbers must not appear as scoring keys either
      expect(payload).not.toMatch(/"correct":\s*50/);
      expect(payload).not.toMatch(/"tolerance":\s*10/);
    }
  });

  it('aggregate is null pre-reveal for hidden-until-close', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'quiz' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'quiz', answer: { kind: 'choice', optionIds: ['b'] } },
        participant('p1'),
      ),
    );
    expect(participantSnapshot(state, 'p1').results).toBeNull();
    expect(stageSnapshot(state).aggregate).toBeNull();
  });

  it('aggregate is visible while open for a `live` resultVisibility interaction', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'live-choice' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'live-choice', answer: { kind: 'choice', optionIds: ['a'] } },
        participant('p1'),
      ),
    );
    expect(participantSnapshot(state, 'p1').results).not.toBeNull();
    expect(stageSnapshot(state).aggregate).not.toBeNull();
    expect(stageSnapshot(state).aggregate).toMatchObject({ kind: 'choice', total: 1 });
  });
});

describe('snapshot security — post-reveal', () => {
  it('correct info becomes present for the stage after reveal (via aggregate + session doc is NOT part of stage snapshot)', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'quiz' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'quiz', answer: { kind: 'choice', optionIds: ['b'] } },
        participant('p1'),
      ),
    );
    state = run(state, env({ command: 'interaction.close', interactionId: 'quiz' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'quiz' }));
    const stage = stageSnapshot(state);
    expect(stage.aggregate).toMatchObject({ kind: 'choice', total: 1 });
    // Even post-reveal, notes/misconception/pedagogy stay off the stage — only the
    // aggregate distribution is exposed; scoring metadata is not part of Aggregate.
    const serialized = JSON.stringify(stage);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
  });

  it('hostSnapshot exposes notes and misconceptions (host is fully trusted)', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    const serialized = JSON.stringify(hostSnapshot(state));
    expect(serialized).toContain(SENTINEL_NOTES);
    expect(serialized).toContain(SENTINEL_MISCONCEPTION);
  });
});

describe('snapshot security — text hiding and frozen sessions', () => {
  it('hidden text entries are absent from stage entries but present (flagged) in host snapshot', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'chat' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: SENTINEL_TEXT_HIDDEN } },
        participant('p1'),
      ),
    );
    // force-hide via host action regardless of blocklist outcome
    state = run(state, env({ command: 'text.hide', interactionId: 'chat', participantId: 'p1' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'chat' }));

    const stage = stageSnapshot(state);
    expect(JSON.stringify(stage)).not.toContain(SENTINEL_TEXT_HIDDEN);

    const host = hostSnapshot(state);
    const serializedHost = JSON.stringify(host);
    expect(serializedHost).toContain(SENTINEL_TEXT_HIDDEN);
    expect(serializedHost).toContain('"hidden":true');
  });

  it('frozen session -> stage shows no text entries at all, even unhidden ones', () => {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'chat' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'a perfectly clean comment' } },
        participant('p1'),
      ),
    );
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'chat' }));
    // sanity: visible before freeze
    expect(JSON.stringify(stageSnapshot(state))).toContain('a perfectly clean comment');

    state = run(state, env({ command: 'session.freeze' }));
    const frozenStage = stageSnapshot(state);
    expect(JSON.stringify(frozenStage)).not.toContain('a perfectly clean comment');
    expect(frozenStage.aggregate).toMatchObject({ kind: 'text', entries: [] });
  });
});

describe('snapshot security — session-local handles (pseudonymous mode)', () => {
  const SENTINEL_HANDLE_P1 = 'SENTINEL_HANDLE_AMBER_FOX';
  const SENTINEL_HANDLE_P2 = 'SENTINEL_HANDLE_SWIFT_WREN';

  function sessionWithHandles(): ReturnType<typeof createSession> {
    let state = run(newSession(), env({ command: 'session.start' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'chat' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hi from p1' } },
        participant('p1'),
      ),
    );
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'chat', answer: { kind: 'text', text: 'hi from p2' } },
        participant('p2'),
      ),
    );
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'chat' }));
    // handles are assigned at join by the session DO; simulate that here
    state.participants['p1'] = { joinedAt: 0, handle: SENTINEL_HANDLE_P1 };
    state.participants['p2'] = { joinedAt: 0, handle: SENTINEL_HANDLE_P2 };
    return state;
  }

  it('stage snapshot never contains any handle, even post-reveal', () => {
    const serialized = JSON.stringify(stageSnapshot(sessionWithHandles()));
    expect(serialized).not.toContain(SENTINEL_HANDLE_P1);
    expect(serialized).not.toContain(SENTINEL_HANDLE_P2);
  });

  it("participant snapshot contains own handle but never a peer's", () => {
    const snap = participantSnapshot(sessionWithHandles(), 'p1');
    expect(snap.yourHandle).toBe(SENTINEL_HANDLE_P1);
    expect(JSON.stringify(snap)).not.toContain(SENTINEL_HANDLE_P2);
  });

  it('host snapshot carries the full handle map', () => {
    const snap = hostSnapshot(sessionWithHandles());
    expect(snap.handles).toEqual({ p1: SENTINEL_HANDLE_P1, p2: SENTINEL_HANDLE_P2 });
  });

  it('anonymous sessions produce no handles field at all', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    expect(hostSnapshot(state).handles).toBeUndefined();
    expect(participantSnapshot(state, 'p1').yourHandle).toBeUndefined();
  });
});
