import { describe, expect, it } from 'vitest';

import {
  FILL_THE_GAPS_GAP_STARTER_ANSWER,
  fillTheGapsGapIssue,
  fillTheGapsPlaceholderIds,
  fillTheGapsPromptText,
  fillTheGapsGapOptions,
  fillTheGapsBankWords,
  insertFillTheGapsRange,
  commitFillTheGapsPrompt,
  gapsForFillTheGapsPrompt,
  gradeFillTheGaps,
  gradeMatch,
  splitFillTheGapsPrompt,
} from '../src/fill-the-gaps-match.js';

describe('splitFillTheGapsPrompt', () => {
  it('splits a sentence into text and gap tokens in reading order', () => {
    expect(splitFillTheGapsPrompt("J'{{g1}} raté le {{train-2}}.")).toEqual([
      { kind: 'text', text: "J'" },
      { kind: 'gap', id: 'g1' },
      { kind: 'text', text: ' raté le ' },
      { kind: 'gap', id: 'train-2' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('emits no empty text spans between adjacent placeholders', () => {
    expect(splitFillTheGapsPrompt('{{a}}{{b}}')).toEqual([
      { kind: 'gap', id: 'a' },
      { kind: 'gap', id: 'b' },
    ]);
  });

  it('leaves malformed placeholders as plain text', () => {
    expect(splitFillTheGapsPrompt('{{ g1 }} and {{G1}}')).toEqual([
      { kind: 'text', text: '{{ g1 }} and {{G1}}' },
    ]);
  });

  it('reports distinct placeholder ids in first-appearance order', () => {
    expect(fillTheGapsPlaceholderIds('{{b}} {{a}} {{b}}')).toEqual(['b', 'a']);
  });
});

describe('fillTheGapsPromptText', () => {
  it('blanks the placeholders when the gaps carry no answers', () => {
    expect(fillTheGapsPromptText("J'{{g1}} raté le train.")).toBe("J'____ raté le train.");
  });

  it('fills the first accepted answer once the interaction is revealed', () => {
    expect(fillTheGapsPromptText("J'{{g1}} raté le train.", [{ id: 'g1', answers: ['ai'] }])).toBe(
      "J'ai raté le train.",
    );
  });
});

describe('commitFillTheGapsPrompt', () => {
  const stored = "J'{{g1}} raté le train.";
  const gaps = [{ id: 'g1', answers: ['ai'] }];

  it('keeps the source when the author commits the blanked heading unchanged', () => {
    expect(commitFillTheGapsPrompt(stored, "J'____ raté le train.", gaps)).toBe(stored);
  });

  it('keeps the source when the author commits the filled heading unchanged', () => {
    expect(commitFillTheGapsPrompt(stored, "J'ai raté le train.", gaps)).toBe(stored);
  });

  it('rebuilds placeholders when the sentence around the blanks changes', () => {
    expect(commitFillTheGapsPrompt(stored, "J'____ raté le bus.", gaps)).toBe("J'{{g1}} raté le bus.");
  });

  it('accepts a sentence the author wrote with placeholders', () => {
    expect(commitFillTheGapsPrompt(stored, "Nous {{g1}} raté le train.", gaps)).toBe(
      "Nous {{g1}} raté le train.",
    );
  });

  it('refuses a rewrite that drops every gap', () => {
    expect(commitFillTheGapsPrompt(stored, 'A whole new sentence.', gaps)).toBe(stored);
  });
});

describe('gapsForFillTheGapsPrompt', () => {
  it('keeps answers for ids that stay and starts a new gap for a new id', () => {
    expect(
      gapsForFillTheGapsPrompt("J'{{g1}} raté le {{g2}}.", [{ id: 'g1', answers: ['ai'] }]),
    ).toEqual([
      { id: 'g1', answers: ['ai'] },
      { id: 'g2', answers: [FILL_THE_GAPS_GAP_STARTER_ANSWER] },
    ]);
  });

  it('drops a gap the sentence no longer names', () => {
    expect(
      gapsForFillTheGapsPrompt("J'{{g1}} raté le train.", [
        { id: 'g1', answers: ['ai'] },
        { id: 'g2', answers: ['train'] },
      ]),
    ).toEqual([{ id: 'g1', answers: ['ai'] }]);
  });
});

describe('fillTheGapsGapIssue', () => {
  it('is silent when every gap has exactly one placeholder', () => {
    expect(
      fillTheGapsGapIssue({
        prompt: "J'{{g1}} raté le {{g2}}.",
        gaps: [
          { id: 'g1', answers: ['ai'] },
          { id: 'g2', answers: ['train'] },
        ],
      }),
    ).toBeNull();
  });

  it('names a gap the sentence never mentions', () => {
    expect(
      fillTheGapsGapIssue({
        prompt: "J'{{g1}} raté le train.",
        gaps: [
          { id: 'g1', answers: ['ai'] },
          { id: 'g2', answers: ['train'] },
        ],
      }),
    ).toContain('{{g2}}');
  });
});

describe('gradeFillTheGaps', () => {
  const interaction = {
    gaps: [
      { id: 'g1', answers: ['été'] },
      { id: 'g2', answers: ["j'ai"] },
    ],
  };

  it('honours the accent policy', () => {
    expect(gradeFillTheGaps(interaction, { g1: 'ete', g2: "j'ai" }).correctCount).toBe(1);
    expect(
      gradeFillTheGaps({ ...interaction, match: { locale: 'fr', accents: 'ignore' } }, {
        g1: 'ete',
        g2: "j'ai",
      }).allCorrect,
    ).toBe(true);
  });

  it('honours the punctuation policy', () => {
    expect(gradeFillTheGaps(interaction, { g1: 'été', g2: 'jai' }).correctCount).toBe(1);
    expect(
      gradeFillTheGaps({ ...interaction, match: { locale: 'fr', punctuation: 'strip' } }, {
        g1: 'été',
        g2: 'jai',
      }).allCorrect,
    ).toBe(true);
  });

  it('grades every authored gap, answered or not', () => {
    const grade = gradeFillTheGaps(interaction, {});
    expect(grade.total).toBe(2);
    expect(grade.gaps.map((gap) => gap.correct)).toEqual([false, false]);
    expect(grade.allCorrect).toBe(false);
  });

  it('never marks a gap with no answer key correct', () => {
    expect(gradeFillTheGaps({ gaps: [{ id: 'g1' }] }, { g1: 'anything' }).correctCount).toBe(0);
  });
});

describe('gradeMatch', () => {
  const key = { quai: 'platform', billet: 'ticket' };

  it('grades a ballot against the answer key', () => {
    expect(gradeMatch(key, { quai: 'platform', billet: 'ticket' }).allCorrect).toBe(true);
    const half = gradeMatch(key, { quai: 'platform', billet: 'platform' });
    expect(half.correctCount).toBe(1);
    expect(half.allCorrect).toBe(false);
  });

  it('keeps a skipped left item as an ungraded row', () => {
    const grade = gradeMatch(key, { quai: 'platform' });
    expect(grade.total).toBe(2);
    expect(grade.pairs.find((pair) => pair.leftId === 'billet')).toEqual({
      leftId: 'billet',
      chosen: undefined,
      correct: false,
    });
  });
});

describe('fillTheGapsGapOptions / fillTheGapsBankWords', () => {
  it('sorts picker options so the correct word is not first by authorship', () => {
    expect(
      fillTheGapsGapOptions({ answers: ['zebra'], distractors: ['apple', 'mango'] }),
    ).toEqual(['apple', 'mango', 'zebra']);
  });

  it('keeps distractors when rebuilding gaps from the prompt', () => {
    expect(
      gapsForFillTheGapsPrompt("J'{{g1}} raté le {{g2}}.", [
        { id: 'g1', answers: ['ai'], distractors: ['suis'] },
      ]),
    ).toEqual([
      { id: 'g1', answers: ['ai'], distractors: ['suis'] },
      { id: 'g2', answers: [FILL_THE_GAPS_GAP_STARTER_ANSWER] },
    ]);
  });

  it('dedupes the bank pool with the match policy', () => {
    expect(
      fillTheGapsBankWords({
        gaps: [{ answers: ['été'] }, { answers: ['ai'] }],
        bank: ['ETE', 'le'],
        match: { locale: 'fr', accents: 'ignore' },
      }),
    ).toEqual(['ai', 'été', 'le']);
  });
});

describe('insertFillTheGapsRange', () => {
  it('wraps the selected word as the next gap', () => {
    expect(insertFillTheGapsRange("J'ai raté le train.", [], 2, 4)).toEqual({
      prompt: "J'{{g1}} raté le train.",
      gaps: [{ id: 'g1', answers: ['ai'] }],
    });
  });

  it('refuses a selection that overlaps an existing placeholder', () => {
    expect(insertFillTheGapsRange("J'{{g1}} raté le train.", [{ id: 'g1', answers: ['ai'] }], 1, 8)).toBeNull();
  });
});
