import { describe, expect, it } from 'vitest';

import {
  apply,
  env,
  expectError,
  fixtureSpec,
  host,
  liveSession,
  newSession,
  sessionWithOpen,
  participant,
  run,
} from './helpers.js';

/**
 * State-machine matrix: every command against every reachable session/interaction
 * status, asserting the exact ok/error code. This is adversarial by design — we
 * enumerate the transitions the implementation actually claims to support per
 * CONTRACTS.md (LIVE-02, LIVE-03, INT-06) rather than only the happy path.
 */

describe('state machine — session.start', () => {
  it('lobby -> live (ok)', () => {
    const state = run(newSession(), env({ command: 'session.start' }));
    expect(state.status).toBe('live');
  });

  it('live -> E_INVALID_TRANSITION', () => {
    expectError(liveSession(), env({ command: 'session.start' }), 'E_INVALID_TRANSITION');
  });

  it('ended -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.start' }), 'E_ENDED');
  });
});

describe('state machine — session.end', () => {
  it('lobby -> ended (ok; no restriction on starting status)', () => {
    const state = run(newSession(), env({ command: 'session.end' }));
    expect(state.status).toBe('ended');
  });

  it('live -> ended (ok), closing whatever was active', () => {
    const state = run(sessionWithOpen('mood'), env({ command: 'session.end' }));
    expect(state.status).toBe('ended');
    expect(state.interactions['mood']?.status).toBe('closed');
  });

  it('ended -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.end' }), 'E_ENDED');
  });
});

describe('state machine — session.freeze / unfreeze', () => {
  it('freeze from lobby is ok', () => {
    const state = run(newSession(), env({ command: 'session.freeze' }));
    expect(state.frozen).toBe(true);
  });

  it('freeze from live is ok', () => {
    const state = run(liveSession(), env({ command: 'session.freeze' }));
    expect(state.frozen).toBe(true);
  });

  it('freeze on ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.freeze' }), 'E_ENDED');
  });

  it('unfreeze on ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.unfreeze' }), 'E_ENDED');
  });

  it('host commands still work while frozen (freeze does not block host actions)', () => {
    let state = run(sessionWithOpen('mood'), env({ command: 'session.freeze' }));
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('closed');
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('revealed');
  });
});

describe('state machine — interaction.open', () => {
  it('lobby -> E_INVALID_TRANSITION (session not live)', () => {
    expectError(
      newSession(),
      env({ command: 'interaction.open', interactionId: 'mood' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('live + unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env({ command: 'interaction.open', interactionId: 'nope' }),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('live + pending interaction -> ok, opens it', () => {
    const state = run(liveSession(), env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('open');
    expect(state.activeInteractionId).toBe('mood');
  });

  it('opening a second interaction closes the first', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.open', interactionId: 'guess' }));
    expect(state.interactions['mood']?.status).toBe('closed');
    expect(state.interactions['guess']?.status).toBe('open');
  });

  it('re-opening the already-open interaction is a no-op (INT-06)', () => {
    const state = sessionWithOpen('mood');
    const result = apply(state, env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(state.revision);
      expect(result.effects).toEqual([]);
    }
  });

  it('opening a closed interaction re-opens it (ok)', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    state = run(state, env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('open');
  });

  it('opening a revealed interaction re-opens it and preserves ballots (ok)', () => {
    let state = sessionWithOpen('mood');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 4 } },
        participant('p1'),
      ),
    );
    const ballots = state.interactions['mood']?.ballots;
    const aggregate = state.interactions['mood']?.aggregate;
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('revealed');
    state = run(state, env({ command: 'interaction.open', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('open');
    expect(state.interactions['mood']?.ballots).toEqual(ballots);
    expect(state.interactions['mood']?.aggregate).toEqual(aggregate);
    expect(state.activeInteractionId).toBe('mood');
  });

  it('ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(
      ended,
      env({ command: 'interaction.open', interactionId: 'mood' }),
      'E_ENDED',
    );
  });
});

describe('state machine — interaction.close', () => {
  it('unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env({ command: 'interaction.close', interactionId: 'nope' }),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('pending interaction -> E_INVALID_TRANSITION', () => {
    expectError(
      liveSession(),
      env({ command: 'interaction.close', interactionId: 'mood' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('open interaction -> ok, closed', () => {
    const state = run(
      sessionWithOpen('mood'),
      env({ command: 'interaction.close', interactionId: 'mood' }),
    );
    expect(state.interactions['mood']?.status).toBe('closed');
  });

  it('already-closed interaction -> E_INVALID_TRANSITION (not a documented no-op)', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    expectError(
      state,
      env({ command: 'interaction.close', interactionId: 'mood' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('revealed interaction -> E_INVALID_TRANSITION', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expectError(
      state,
      env({ command: 'interaction.close', interactionId: 'mood' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'interaction.close', interactionId: 'mood' }), 'E_ENDED');
  });
});

describe('state machine — interaction.reveal', () => {
  it('unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env({ command: 'interaction.reveal', interactionId: 'nope' }),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('pending interaction -> E_INVALID_TRANSITION (never opened)', () => {
    expectError(
      liveSession(),
      env({ command: 'interaction.reveal', interactionId: 'mood' }),
      'E_INVALID_TRANSITION',
    );
  });

  it('open interaction -> ok, revealed', () => {
    const state = run(
      sessionWithOpen('mood'),
      env({ command: 'interaction.reveal', interactionId: 'mood' }),
    );
    expect(state.interactions['mood']?.status).toBe('revealed');
  });

  it('closed interaction -> ok, revealed', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expect(state.interactions['mood']?.status).toBe('revealed');
  });

  it('already-revealed interaction -> no-op, no revision bump (documented no-op)', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    const before = state.revision;
    const result = apply(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(before);
      expect(result.effects).toEqual([]);
    }
  });

  it('ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'interaction.reveal', interactionId: 'mood' }), 'E_ENDED');
  });
});

describe('state machine — session.advance', () => {
  it('lobby -> E_INVALID_TRANSITION', () => {
    expectError(newSession(), env({ command: 'session.advance' }), 'E_INVALID_TRANSITION');
  });

  it('live with nothing open -> opens the first pending interaction', () => {
    const state = run(liveSession(), env({ command: 'session.advance' }));
    expect(state.activeInteractionId).toBe(fixtureSpec.interactions[0]!.id);
  });

  it('advancing closes the current interaction and opens the next pending one', () => {
    let state = sessionWithOpen('single-choice');
    state = run(state, env({ command: 'session.advance' }));
    expect(state.interactions['single-choice']?.status).toBe('closed');
    expect(state.activeInteractionId).toBe('locked-choice');
  });

  it('advancing past the last pending interaction -> E_INVALID_TRANSITION', () => {
    let state = liveSession();
    for (const interaction of fixtureSpec.interactions) {
      void interaction;
      state = run(state, env({ command: 'session.advance' }));
    }
    expectError(state, env({ command: 'session.advance' }), 'E_INVALID_TRANSITION');
  });

  it('ended session -> E_ENDED', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(ended, env({ command: 'session.advance' }), 'E_ENDED');
  });
});

describe('state machine — text.hide / text.unhide', () => {
  it('unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env({ command: 'text.hide', interactionId: 'nope', participantId: 'p1' }),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('no ballot from that participant -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('reflection'),
      env({ command: 'text.hide', interactionId: 'reflection', participantId: 'ghost' }),
      'E_INVALID_ANSWER',
    );
  });

  it('non-text/qna ballot kind -> E_INVALID_ANSWER', () => {
    let state = sessionWithOpen('mood');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
    );
    expectError(
      state,
      env({ command: 'text.hide', interactionId: 'mood', participantId: 'p1' }),
      'E_INVALID_ANSWER',
    );
  });

  it('hides a text ballot even on an ended session is not possible (E_ENDED wins)', () => {
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'reflection',
          answer: { kind: 'text', text: 'hello' },
        },
        participant('p1'),
      ),
    );
    const ended = run(state, env({ command: 'session.end' }));
    expectError(
      ended,
      env({ command: 'text.hide', interactionId: 'reflection', participantId: 'p1' }),
      'E_ENDED',
    );
  });

  it('works on a closed/revealed interaction (no open-state requirement)', () => {
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'reflection',
          answer: { kind: 'text', text: 'hello' },
        },
        participant('p1'),
      ),
    );
    state = run(state, env({ command: 'interaction.close', interactionId: 'reflection' }));
    state = run(
      state,
      env({ command: 'text.hide', interactionId: 'reflection', participantId: 'p1' }),
    );
    expect(state.interactions['reflection']?.ballots['p1']).toMatchObject({ hidden: true });
  });
});

describe('state machine — answer.submit', () => {
  it('unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env(
        { command: 'answer.submit', interactionId: 'nope', answer: { kind: 'text', text: 'x' } },
        participant('p1'),
      ),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('pending interaction -> E_NOT_OPEN', () => {
    expectError(
      liveSession(),
      env(
        {
          command: 'answer.submit',
          interactionId: 'mood',
          answer: { kind: 'scale', value: 3 },
        },
        participant('p1'),
      ),
      'E_NOT_OPEN',
    );
  });

  it('closed interaction -> E_NOT_OPEN', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_NOT_OPEN',
    );
  });

  it('revealed interaction -> E_NOT_OPEN', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'mood' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_NOT_OPEN',
    );
  });

  it('open interaction -> ok', () => {
    const state = run(
      sessionWithOpen('mood'),
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
    );
    expect(state.interactions['mood']?.ballots['p1']).toMatchObject({ value: 3 });
  });

  it('frozen session -> E_FROZEN, even for an open interaction', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'session.freeze' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_FROZEN',
    );
  });

  it('frozen takes priority over E_UNKNOWN_INTERACTION', () => {
    let state = sessionWithOpen('mood');
    state = run(state, env({ command: 'session.freeze' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'nope', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_FROZEN',
    );
  });

  it('ended session -> E_ENDED (checked before frozen/not-open)', () => {
    const ended = run(liveSession(), env({ command: 'session.end' }));
    expectError(
      ended,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_ENDED',
    );
  });

  it('host actor cannot submit an answer -> E_FORBIDDEN', () => {
    expectError(
      sessionWithOpen('mood'),
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        host(),
      ),
      'E_FORBIDDEN',
    );
  });

  it('participant actor missing participantId -> E_FORBIDDEN', () => {
    expectError(
      sessionWithOpen('mood'),
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        { role: 'participant' },
      ),
      'E_FORBIDDEN',
    );
  });
});

describe('state machine — qna.vote', () => {
  it('unknown interaction -> E_UNKNOWN_INTERACTION', () => {
    expectError(
      liveSession(),
      env(
        { command: 'qna.vote', interactionId: 'nope', targetParticipantId: 'x' },
        participant('p1'),
      ),
      'E_UNKNOWN_INTERACTION',
    );
  });

  it('non-qna interaction -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('mood'),
      env(
        { command: 'qna.vote', interactionId: 'mood', targetParticipantId: 'x' },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('pending qna interaction -> E_NOT_OPEN', () => {
    expectError(
      liveSession(),
      env(
        { command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'x' },
        participant('p1'),
      ),
      'E_NOT_OPEN',
    );
  });

  it('no such question to vote for -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('ask'),
      env(
        { command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'ghost' },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('frozen session -> E_FROZEN', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Why?' } },
        participant('asker'),
      ),
    );
    state = run(state, env({ command: 'session.freeze' }));
    expectError(
      state,
      env(
        { command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker' },
        participant('voter'),
      ),
      'E_FROZEN',
    );
  });

  it('host actor cannot vote -> E_FORBIDDEN', () => {
    expectError(
      sessionWithOpen('ask'),
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'x' }, host()),
      'E_FORBIDDEN',
    );
  });
});
