import type { Session } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { createSession, participantSnapshot, stageSnapshot } from '../src/index.js';
import { env, expectError, participant, run } from './helpers.js';

const session: Session = {
  version: 1,
  meta: { title: 'Language checks' },
  defaults: { resultVisibility: 'hidden-until-close' },
  interactions: [
    {
      id: 'gap',
      type: 'fill-the-gaps',
      prompt: "J'{{g1}} raté le train.",
      gaps: [{ id: 'g1', answers: ['ai'] }],
      match: { locale: 'fr' },
    },
    {
      id: 'pair',
      type: 'match',
      prompt: 'Match',
      left: [
        { id: 'rater', label: 'rater le train' },
        { id: 'manquer', label: 'manquer de' },
      ],
      right: [
        { id: 'miss', label: 'to miss the train' },
        { id: 'lack', label: 'to lack' },
      ],
      correct: { rater: 'miss', manquer: 'lack' },
    },
  ],
};

function started() {
  let state = createSession(session, 'FILL_THE_GAPS001', 0);
  return run(state, env({ command: 'session.start' }));
}

describe('fill-the-gaps ballots', () => {
  it('accepts a complete gap fill and hides keys until reveal', () => {
    let state = started();
    state = run(state, env({ command: 'interaction.open', interactionId: 'gap' }));
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'gap', answer: { kind: 'fill-the-gaps', gaps: { g1: 'ai' } } },
        participant('lea'),
      ),
    );
    const open = JSON.stringify(participantSnapshot(state, 'lea'));
    expect(open).not.toContain('"answers"');
    expect(participantSnapshot(state, 'lea').yourAnswer).toEqual({
      kind: 'fill-the-gaps',
      gaps: { g1: 'ai' },
    });
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'gap' }));
    expect(stageSnapshot(state).aggregate?.kind).toBe('fill-the-gaps');
  });

  it('rejects a missing gap', () => {
    let state = started();
    state = run(state, env({ command: 'interaction.open', interactionId: 'gap' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'gap', answer: { kind: 'fill-the-gaps', gaps: {} } },
        participant('lea'),
      ),
      'E_INVALID_ANSWER',
    );
  });
});

describe('match ballots', () => {
  it('accepts a complete pairing and strips correct until reveal', () => {
    let state = started();
    state = run(state, env({ command: 'interaction.open', interactionId: 'pair' }));
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'pair',
          answer: { kind: 'match', pairs: { rater: 'miss', manquer: 'lack' } },
        },
        participant('lea'),
      ),
    );
    const open = JSON.stringify(participantSnapshot(state, 'lea'));
    expect(open).not.toContain('"correct"');
    expect(participantSnapshot(state, 'lea').yourAnswer).toEqual({
      kind: 'match',
      pairs: { rater: 'miss', manquer: 'lack' },
    });
    state = run(state, env({ command: 'interaction.reveal', interactionId: 'pair' }));
    expect(stageSnapshot(state).aggregate?.kind).toBe('match');
  });

  it('rejects a reused right item', () => {
    let state = started();
    state = run(state, env({ command: 'interaction.open', interactionId: 'pair' }));
    expectError(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'pair',
          answer: { kind: 'match', pairs: { rater: 'miss', manquer: 'miss' } },
        },
        participant('lea'),
      ),
      'E_INVALID_ANSWER',
    );
  });
});
