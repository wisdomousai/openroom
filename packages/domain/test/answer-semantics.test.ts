import { describe, expect, it } from 'vitest';

import { env, expectError, sessionWithOpen, participant, run } from './helpers.js';

describe('answer semantics — replacement not duplication', () => {
  it('500 sequential submits from the same participant leave exactly 1 ballot and total 1', () => {
    let state = sessionWithOpen('mood');
    for (let i = 0; i < 500; i += 1) {
      const value = 1 + (i % 5);
      state = run(
        state,
        env(
          { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value } },
          participant('p1'),
        ),
      );
    }
    expect(Object.keys(state.interactions['mood']!.ballots)).toEqual(['p1']);
    const aggregate = state.interactions['mood']!.aggregate;
    if (aggregate.kind !== 'scale') throw new Error('expected scale aggregate');
    expect(aggregate.total).toBe(1);
    // last value written was value for i=499: 1 + (499 % 5) = 1 + 4 = 5
    expect(aggregate.counts[5]).toBe(1);
  });

  it('change after close -> E_NOT_OPEN', () => {
    let state = sessionWithOpen('mood');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
    );
    state = run(state, env({ command: 'interaction.close', interactionId: 'mood' }));
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 4 } },
        participant('p1'),
      ),
      'E_NOT_OPEN',
    );
  });

  it('allowAnswerChange: false -> second submit E_FORBIDDEN', () => {
    let state = sessionWithOpen('locked-choice');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'locked-choice', answer: { kind: 'choice', optionIds: ['a'] } },
        participant('p1'),
      ),
    );
    expectError(
      state,
      env(
        { command: 'answer.submit', interactionId: 'locked-choice', answer: { kind: 'choice', optionIds: ['b'] } },
        participant('p1'),
      ),
      'E_FORBIDDEN',
    );
  });

  it('allowAnswerChange: false still allows the FIRST submit', () => {
    const state = run(
      sessionWithOpen('locked-choice'),
      env(
        { command: 'answer.submit', interactionId: 'locked-choice', answer: { kind: 'choice', optionIds: ['a'] } },
        participant('p1'),
      ),
    );
    expect(state.interactions['locked-choice']?.ballots['p1']).toMatchObject({ optionIds: ['a'] });
  });

  it('a different participant is unaffected by allowAnswerChange: false', () => {
    let state = sessionWithOpen('locked-choice');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'locked-choice', answer: { kind: 'choice', optionIds: ['a'] } },
        participant('p1'),
      ),
    );
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'locked-choice', answer: { kind: 'choice', optionIds: ['b'] } },
        participant('p2'),
      ),
    );
    expect(state.interactions['locked-choice']?.ballots['p2']).toMatchObject({ optionIds: ['b'] });
  });
});

describe('answer semantics — dont-know', () => {
  it('counted in dontKnow and in total, for choice', () => {
    let state = sessionWithOpen('single-choice');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'dont-know' } },
        participant('p1'),
      ),
    );
    const aggregate = state.interactions['single-choice']!.aggregate;
    if (aggregate.kind !== 'choice') throw new Error('expected choice aggregate');
    expect(aggregate.dontKnow).toBe(1);
    expect(aggregate.total).toBe(1);
  });

  it('counted in dontKnow and in total, but not in the mean, for numeric', () => {
    let state = sessionWithOpen('guess');
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: 100 } },
        participant('p1'),
      ),
    );
    state = run(
      state,
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'dont-know' } },
        participant('p2'),
      ),
    );
    const aggregate = state.interactions['guess']!.aggregate;
    if (aggregate.kind !== 'numeric') throw new Error('expected numeric aggregate');
    expect(aggregate.dontKnow).toBe(1);
    expect(aggregate.total).toBe(2);
    expect(aggregate.mean).toBe(100);
  });

  it('rejected with E_INVALID_ANSWER when allowDontKnow is not set', () => {
    // 'mood' (scale) does not set allowDontKnow
    expectError(
      sessionWithOpen('mood'),
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'dont-know' } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });
});

describe('answer semantics — choice validation', () => {
  it('multiple:false interaction rejects 2 optionIds -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('single-choice'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'single-choice',
          answer: { kind: 'choice', optionIds: ['yes', 'no'] },
        },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('multiple:true interaction accepts 2 optionIds', () => {
    const state = run(
      sessionWithOpen('multi-choice'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'multi-choice',
          answer: { kind: 'choice', optionIds: ['x', 'y'] },
        },
        participant('p1'),
      ),
    );
    expect(state.interactions['multi-choice']?.ballots['p1']).toMatchObject({
      optionIds: ['x', 'y'],
    });
  });

  it('empty optionIds -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('single-choice'),
      env(
        { command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: [] } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('duplicate option ids in one submission -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('multi-choice'),
      env(
        { command: 'answer.submit', interactionId: 'multi-choice', answer: { kind: 'choice', optionIds: ['x', 'x'] } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('unknown option id -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('single-choice'),
      env(
        { command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['ghost'] } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });
});

describe('answer semantics — scale validation', () => {
  it('value out of range -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('mood'),
      env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 6 } }, participant('p1')),
      'E_INVALID_ANSWER',
    );
    expectError(
      sessionWithOpen('mood'),
      env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 0 } }, participant('p1')),
      'E_INVALID_ANSWER',
    );
  });

  it('non-integer value -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('mood'),
      env(
        { command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 2.5 } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('boundary values (min, max) are accepted', () => {
    let state = run(
      sessionWithOpen('mood'),
      env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 1 } }, participant('p1')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value: 5 } }, participant('p2')),
    );
    expect(state.interactions['mood']?.ballots['p1']).toMatchObject({ value: 1 });
    expect(state.interactions['mood']?.ballots['p2']).toMatchObject({ value: 5 });
  });
});

describe('answer semantics — numeric validation', () => {
  it('NaN -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('guess'),
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: NaN } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('Infinity -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('guess'),
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: Infinity } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('-Infinity -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('guess'),
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: -Infinity } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('finite numbers, including negative and fractional, are accepted', () => {
    let state = run(
      sessionWithOpen('guess'),
      env(
        { command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value: -3.5 } },
        participant('p1'),
      ),
    );
    expect(state.interactions['guess']?.ballots['p1']).toMatchObject({ value: -3.5 });
  });
});

describe('answer semantics — text validation', () => {
  it('over maxLength -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('reflection'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'reflection',
          answer: { kind: 'text', text: 'x'.repeat(21) },
        },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('exactly at maxLength is accepted', () => {
    const state = run(
      sessionWithOpen('reflection'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'reflection',
          answer: { kind: 'text', text: 'x'.repeat(20) },
        },
        participant('p1'),
      ),
    );
    expect(state.interactions['reflection']?.ballots['p1']).toMatchObject({ text: 'x'.repeat(20) });
  });

  it('empty (whitespace-only) text -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('reflection'),
      env(
        { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: '   ' } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('answer kind mismatch (wrong shape for the interaction type) -> E_INVALID_ANSWER', () => {
    expectError(
      sessionWithOpen('reflection'),
      env(
        { command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'scale', value: 3 } },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });
});
