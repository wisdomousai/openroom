import { describe, expect, it } from 'vitest';

import { computeAggregate, emptyAggregate } from '../src/aggregate.js';
import { normalizeSession } from '@openroom/schema';
import type { Aggregate, Ballot } from '../src/types.js';
import { env, expectError, fixtureSpec, sessionWithOpen, participant, run } from './helpers.js';

/** The normalized `priority` interaction (3 options: alpha, beta, gamma). */
const normalized = normalizeSession(fixtureSpec);
const priority = normalized.interactions.find((i) => i.id === 'priority')!;

function rankingAggregate(aggregate: Aggregate): Extract<Aggregate, { kind: 'ranking' }> {
  if (aggregate.kind !== 'ranking') throw new Error(`expected a ranking aggregate`);
  return aggregate;
}

describe('ranking ballots — complete permutations only', () => {
  const answer = (optionIds: string[]) =>
    env(
      { command: 'answer.submit', interactionId: 'priority', answer: { kind: 'ranking', optionIds } },
      participant('p1'),
    );

  it('accepts a complete permutation of the option ids', () => {
    const state = run(sessionWithOpen('priority'), answer(['gamma', 'alpha', 'beta']));
    expect(state.interactions['priority']?.ballots['p1']).toEqual({
      kind: 'ranking',
      optionIds: ['gamma', 'alpha', 'beta'],
    });
  });

  it('accepts any order — there is no correct ranking', () => {
    const state = run(sessionWithOpen('priority'), answer(['alpha', 'beta', 'gamma']));
    expect(state.interactions['priority']?.ballots['p1']).toMatchObject({ kind: 'ranking' });
  });

  it('E_INVALID_ANSWER: a partial ranking', () => {
    expectError(sessionWithOpen('priority'), answer(['alpha', 'beta']), 'E_INVALID_ANSWER');
  });

  it('E_INVALID_ANSWER: an empty ranking', () => {
    expectError(sessionWithOpen('priority'), answer([]), 'E_INVALID_ANSWER');
  });

  it('E_INVALID_ANSWER: a repeated option (not a permutation)', () => {
    expectError(sessionWithOpen('priority'), answer(['alpha', 'alpha', 'beta']), 'E_INVALID_ANSWER');
  });

  it('E_INVALID_ANSWER: an unknown option id', () => {
    expectError(sessionWithOpen('priority'), answer(['alpha', 'beta', 'delta']), 'E_INVALID_ANSWER');
  });

  it('E_INVALID_ANSWER: too many ids, even when all are known', () => {
    expectError(
      sessionWithOpen('priority'),
      answer(['alpha', 'beta', 'gamma', 'alpha']),
      'E_INVALID_ANSWER',
    );
  });

  it('E_INVALID_ANSWER: a choice answer aimed at a ranking interaction', () => {
    expectError(
      sessionWithOpen('priority'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'priority',
          answer: { kind: 'choice', optionIds: ['alpha'] },
        },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('E_INVALID_ANSWER: a ranking answer aimed at a choice interaction', () => {
    expectError(
      sessionWithOpen('single-choice'),
      env(
        {
          command: 'answer.submit',
          interactionId: 'single-choice',
          answer: { kind: 'ranking', optionIds: ['yes', 'no'] },
        },
        participant('p1'),
      ),
      'E_INVALID_ANSWER',
    );
  });

  it('a resubmission replaces the previous ordering', () => {
    let state = run(sessionWithOpen('priority'), answer(['alpha', 'beta', 'gamma']));
    state = run(
      state,
      env(
        {
          command: 'answer.submit',
          interactionId: 'priority',
          answer: { kind: 'ranking', optionIds: ['gamma', 'beta', 'alpha'] },
        },
        participant('p1'),
      ),
    );
    expect(state.interactions['priority']?.ballots['p1']).toEqual({
      kind: 'ranking',
      optionIds: ['gamma', 'beta', 'alpha'],
    });
    expect(rankingAggregate(state.interactions['priority']!.aggregate).total).toBe(1);
  });
});

describe('ranking aggregate — Borda scores and average ranks', () => {
  it('the empty aggregate zeroes every score and nulls every average rank', () => {
    const empty = rankingAggregate(emptyAggregate(priority));
    expect(empty).toEqual({
      kind: 'ranking',
      scores: { alpha: 0, beta: 0, gamma: 0 },
      avgRank: { alpha: null, beta: null, gamma: null },
      total: 0,
      dontKnow: 0,
    });
  });

  /**
   * Hand-computed fixture. k = 3, so a first place is worth 3 points, a second
   * 2, a third 1.
   *
   *   p1: alpha, beta,  gamma
   *   p2: alpha, gamma, beta
   *   p3: beta,  alpha, gamma
   *   p4: gamma, beta,  alpha
   *
   *   alpha: 3 + 3 + 2 + 1 = 9   ranks 1,1,2,3 -> mean 7/4  = 1.75
   *   beta:  2 + 1 + 3 + 2 = 8   ranks 2,3,1,2 -> mean 8/4  = 2
   *   gamma: 1 + 2 + 1 + 3 = 7   ranks 3,2,3,1 -> mean 9/4  = 2.25
   */
  const ballots: Record<string, Ballot> = {
    p1: { kind: 'ranking', optionIds: ['alpha', 'beta', 'gamma'] },
    p2: { kind: 'ranking', optionIds: ['alpha', 'gamma', 'beta'] },
    p3: { kind: 'ranking', optionIds: ['beta', 'alpha', 'gamma'] },
    p4: { kind: 'ranking', optionIds: ['gamma', 'beta', 'alpha'] },
  };

  it('matches the hand-computed Borda counts and mean 1-based ranks', () => {
    const aggregate = rankingAggregate(computeAggregate(priority, ballots));
    expect(aggregate.scores).toEqual({ alpha: 9, beta: 8, gamma: 7 });
    expect(aggregate.avgRank).toEqual({ alpha: 1.75, beta: 2, gamma: 2.25 });
    expect(aggregate.total).toBe(4);
    expect(aggregate.dontKnow).toBe(0);
  });

  it('every ballot contributes the same point pool (k*(k+1)/2 per ballot)', () => {
    const aggregate = rankingAggregate(computeAggregate(priority, ballots));
    const sum = Object.values(aggregate.scores).reduce((a, b) => a + b, 0);
    expect(sum).toBe(4 * ((3 * (3 + 1)) / 2));
  });

  it('a single ballot gives k, k-1 … 1 points and ranks 1, 2 … k', () => {
    const aggregate = rankingAggregate(
      computeAggregate(priority, { p1: { kind: 'ranking', optionIds: ['beta', 'gamma', 'alpha'] } }),
    );
    expect(aggregate.scores).toEqual({ beta: 3, gamma: 2, alpha: 1 });
    expect(aggregate.avgRank).toEqual({ beta: 1, gamma: 2, alpha: 3 });
    expect(aggregate.total).toBe(1);
  });

  it("counts \"I don't know\" in the total: it never scores and never moves an average", () => {
    const aggregate = rankingAggregate(
      computeAggregate(priority, {
        p1: { kind: 'ranking', optionIds: ['alpha', 'beta', 'gamma'] },
        p2: { kind: 'dont-know' },
        p3: { kind: 'dont-know' },
      }),
    );
    expect(aggregate.scores).toEqual({ alpha: 3, beta: 2, gamma: 1 });
    expect(aggregate.avgRank).toEqual({ alpha: 1, beta: 2, gamma: 3 });
    expect(aggregate.total).toBe(3);
    expect(aggregate.dontKnow).toBe(2);
  });

  it('avgRank stays null for every option when only dont-know ballots exist', () => {
    const aggregate = rankingAggregate(
      computeAggregate(priority, { p1: { kind: 'dont-know' } }),
    );
    expect(aggregate.avgRank).toEqual({ alpha: null, beta: null, gamma: null });
    expect(aggregate.total).toBe(1);
    expect(aggregate.dontKnow).toBe(1);
  });

  it('is order-independent in the ballot map: only the ballots matter', () => {
    const reversed = Object.fromEntries(Object.entries(ballots).reverse());
    expect(computeAggregate(priority, reversed)).toEqual(computeAggregate(priority, ballots));
  });

  it('is recomputed and stored on every submission', () => {
    let state = sessionWithOpen('priority');
    for (const [participantId, ballot] of Object.entries(ballots)) {
      if (ballot.kind !== 'ranking') continue;
      state = run(
        state,
        env(
          {
            command: 'answer.submit',
            interactionId: 'priority',
            answer: { kind: 'ranking', optionIds: ballot.optionIds },
          },
          participant(participantId),
        ),
      );
    }
    const aggregate = rankingAggregate(state.interactions['priority']!.aggregate);
    expect(aggregate.scores).toEqual({ alpha: 9, beta: 8, gamma: 7 });
    expect(aggregate.avgRank).toEqual({ alpha: 1.75, beta: 2, gamma: 2.25 });
  });
});
