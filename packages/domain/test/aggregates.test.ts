import { describe, expect, it } from 'vitest';

import { env, sessionWithOpen, participant, run } from './helpers.js';

describe('aggregates — choice', () => {
  it('counts per option and includes dont-know in the total', () => {
    let state = sessionWithOpen('single-choice');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['yes'] } }, participant('p1')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['yes'] } }, participant('p2')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'choice', optionIds: ['no'] } }, participant('p3')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'single-choice', answer: { kind: 'dont-know' } }, participant('p4')),
    );
    const aggregate = state.interactions['single-choice']!.aggregate;
    if (aggregate.kind !== 'choice') throw new Error('expected choice');
    expect(aggregate.counts).toEqual({ yes: 2, no: 1 });
    expect(aggregate.total).toBe(4);
    expect(aggregate.dontKnow).toBe(1);
  });

  it('multi-select increments every selected option', () => {
    let state = sessionWithOpen('multi-choice');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'multi-choice', answer: { kind: 'choice', optionIds: ['x', 'y'] } }, participant('p1')),
    );
    const aggregate = state.interactions['multi-choice']!.aggregate;
    if (aggregate.kind !== 'choice') throw new Error('expected choice');
    expect(aggregate.counts).toEqual({ x: 1, y: 1, z: 0 });
    expect(aggregate.total).toBe(1);
  });
});

describe('aggregates — scale', () => {
  it('computes mean and per-value counts', () => {
    let state = sessionWithOpen('mood');
    for (const [id, value] of [
      ['p1', 1],
      ['p2', 3],
      ['p3', 5],
    ] as const) {
      state = run(
        state,
        env({ command: 'answer.submit', interactionId: 'mood', answer: { kind: 'scale', value } }, participant(id)),
      );
    }
    const aggregate = state.interactions['mood']!.aggregate;
    if (aggregate.kind !== 'scale') throw new Error('expected scale');
    expect(aggregate.total).toBe(3);
    expect(aggregate.mean).toBe(3);
    expect(aggregate.counts[1]).toBe(1);
    expect(aggregate.counts[3]).toBe(1);
    expect(aggregate.counts[5]).toBe(1);
  });

  it('mean is null with zero ballots', () => {
    const state = sessionWithOpen('mood');
    const aggregate = state.interactions['mood']!.aggregate;
    if (aggregate.kind !== 'scale') throw new Error('expected scale');
    expect(aggregate.mean).toBeNull();
    expect(aggregate.total).toBe(0);
  });
});

describe('aggregates — numeric', () => {
  it('mean and median for an ODD count of values', () => {
    let state = sessionWithOpen('guess');
    for (const [id, value] of [
      ['p1', 4],
      ['p2', 10],
      ['p3', 100],
    ] as const) {
      state = run(
        state,
        env({ command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value } }, participant(id)),
      );
    }
    const aggregate = state.interactions['guess']!.aggregate;
    if (aggregate.kind !== 'numeric') throw new Error('expected numeric');
    expect(aggregate.total).toBe(3);
    expect(aggregate.mean).toBeCloseTo((4 + 10 + 100) / 3);
    expect(aggregate.median).toBe(10);
  });

  it('mean and median for an EVEN count of values', () => {
    let state = sessionWithOpen('guess');
    for (const [id, value] of [
      ['p1', 4],
      ['p2', 10],
      ['p3', 16],
      ['p4', 100],
    ] as const) {
      state = run(
        state,
        env({ command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value } }, participant(id)),
      );
    }
    const aggregate = state.interactions['guess']!.aggregate;
    if (aggregate.kind !== 'numeric') throw new Error('expected numeric');
    expect(aggregate.total).toBe(4);
    expect(aggregate.mean).toBeCloseTo((4 + 10 + 16 + 100) / 4);
    // sorted: 4, 10, 16, 100 -> median = (10+16)/2 = 13
    expect(aggregate.median).toBe(13);
  });

  it('mean and median are null with zero ballots', () => {
    const state = sessionWithOpen('guess');
    const aggregate = state.interactions['guess']!.aggregate;
    if (aggregate.kind !== 'numeric') throw new Error('expected numeric');
    expect(aggregate.mean).toBeNull();
    expect(aggregate.median).toBeNull();
  });

  it('values array is sorted ascending regardless of submission order', () => {
    let state = sessionWithOpen('guess');
    for (const [id, value] of [
      ['p1', 100],
      ['p2', 4],
      ['p3', 10],
    ] as const) {
      state = run(
        state,
        env({ command: 'answer.submit', interactionId: 'guess', answer: { kind: 'numeric', value } }, participant(id)),
      );
    }
    const aggregate = state.interactions['guess']!.aggregate;
    if (aggregate.kind !== 'numeric') throw new Error('expected numeric');
    expect(aggregate.values).toEqual([4, 10, 100]);
  });
});

describe('aggregates — text', () => {
  it('one entry per participant, including hidden flag', () => {
    let state = sessionWithOpen('reflection');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'clean text' } }, participant('p1')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'reflection', answer: { kind: 'text', text: 'this is shit' } }, participant('p2')),
    );
    const aggregate = state.interactions['reflection']!.aggregate;
    if (aggregate.kind !== 'text') throw new Error('expected text');
    expect(aggregate.total).toBe(2);
    const p1entry = aggregate.entries.find((e) => e.participantId === 'p1');
    const p2entry = aggregate.entries.find((e) => e.participantId === 'p2');
    expect(p1entry).toMatchObject({ hidden: false, text: 'clean text' });
    expect(p2entry).toMatchObject({ hidden: true });
  });
});

describe('aggregates — qna', () => {
  it('one entry per asker with votes and hidden flag, sorted by votes desc', () => {
    let state = sessionWithOpen('ask');
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Question A' } }, participant('asker-a')),
    );
    state = run(
      state,
      env({ command: 'answer.submit', interactionId: 'ask', answer: { kind: 'qna', text: 'Question B' } }, participant('asker-b')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker-b' }, participant('v1')),
    );
    state = run(
      state,
      env({ command: 'qna.vote', interactionId: 'ask', targetParticipantId: 'asker-b' }, participant('v2')),
    );
    const aggregate = state.interactions['ask']!.aggregate;
    if (aggregate.kind !== 'qna') throw new Error('expected qna');
    expect(aggregate.total).toBe(2);
    expect(aggregate.entries[0]).toMatchObject({ participantId: 'asker-b', votes: 2 });
    expect(aggregate.entries[1]).toMatchObject({ participantId: 'asker-a', votes: 0 });
  });
});
