import { describe, expect, it } from 'vitest';
import {
  bucketize,
  tallyWords,
  rankRows,
  rankingSummary,
  choiceRoundsSummary,
  deltaMark,
} from '@openroom/charts';
import type { ChoiceInteractionView, RankingInteractionView } from '@openroom/sdk';

describe('bucketize', () => {
  it('buckets values into nice, covering ranges', () => {
    const b = bucketize([1, 2, 2, 3, 9, 10, 10, 10], null);
    expect(b.counts.reduce((a, c) => a + c, 0)).toBe(8);
    expect(b.start).toBeLessThanOrEqual(1);
    expect(b.end).toBeGreaterThanOrEqual(10);
    expect(b.step).toBeGreaterThan(0);
  });

  it('survives an empty set and a single repeated value', () => {
    expect(bucketize([], null).counts).toEqual([0]);
    const same = bucketize([5, 5, 5], null);
    expect(same.counts.reduce((a, c) => a + c, 0)).toBe(3);
  });

  it('widens the range to include a revealed correct value', () => {
    const b = bucketize([10, 12, 11], 40);
    expect(b.end).toBeGreaterThanOrEqual(40);
  });
});

describe('tallyWords', () => {
  it('lowercases, strips stopwords and punctuation, and ranks by frequency', () => {
    const words = tallyWords(['The Rabbit, the rabbit!', 'a RABBIT and some Carrots']);
    expect(words[0]).toEqual({ word: 'rabbit', count: 3 });
    expect(words.map((w) => w.word)).toContain('carrots');
    expect(words.map((w) => w.word)).not.toContain('the');
  });

  it('drops very short tokens', () => {
    expect(tallyWords(['ok go up hi'])).toEqual([]);
  });
});

const rankingInteraction: RankingInteractionView = {
  id: 'r',
  type: 'ranking',
  prompt: 'Order these',
  display: 'ordered-bars',
  options: [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ],
};

describe('rankRows', () => {
  it('sorts by Borda score, highest first', () => {
    const rows = rankRows({
      interaction: rankingInteraction,
      scores: { a: 4, b: 9, c: 7 },
      avgRank: { a: 2.5, b: 1.2, c: 2 },
    });
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(rows[0]!.avgRank).toBe(1.2);
  });

  it('breaks ties by label so the order never jitters', () => {
    const rows = rankRows({
      interaction: rankingInteraction,
      scores: { a: 5, b: 5, c: 5 },
      avgRank: { a: 2, b: 2, c: 2 },
    });
    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('treats a missing option as zero rather than dropping it', () => {
    const rows = rankRows({ interaction: rankingInteraction, scores: {}, avgRank: {} });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.score === 0 && r.avgRank === null)).toBe(true);
  });
});

describe('rankingSummary', () => {
  it('reads out the order, the scores and the average ranks', () => {
    const summary = rankingSummary({
      interaction: rankingInteraction,
      revealed: true,
      scores: { a: 4, b: 9, c: 7 },
      avgRank: { a: 2.5, b: 1.2, c: 2 },
      total: 5,
      dontKnow: 1,
    });
    expect(summary).toContain('5 rankings');
    expect(summary).toContain('1. Beta, 9 points, average rank 1.2');
    expect(summary).toContain('3. Alpha, 4 points');
    expect(summary).toContain("1 don't know");
  });
});

describe('deltaMark', () => {
  it('marks a gain, a loss and no change', () => {
    expect(deltaMark(20, 60).mark).toBe('▲');
    expect(deltaMark(60, 20).mark).toBe('▼');
    expect(deltaMark(40, 40)).toEqual({ mark: '=', word: 'unchanged' });
  });
});

describe('choiceRoundsSummary', () => {
  const interaction: ChoiceInteractionView = {
    id: 'v',
    type: 'choice',
    prompt: 'Which?',
    peerInstruction: true,
    options: [
      { id: 'right', label: 'Right', correct: true },
      { id: 'wrong', label: 'Wrong' },
    ],
  };

  it('covers both rounds and the direction of travel', () => {
    const summary = choiceRoundsSummary({
      interaction,
      revealed: true,
      counts: { right: 8, wrong: 2 },
      total: 10,
      dontKnow: 0,
      round1Counts: { right: 3, wrong: 7 },
      round1Total: 10,
    });
    expect(summary).toContain('Round 1 10 answers');
    expect(summary).toContain('round 2 10 answers');
    expect(summary).toContain('Right 30% to 80% (up) (correct)');
    expect(summary).toContain('Wrong 70% to 20% (down)');
  });
});
