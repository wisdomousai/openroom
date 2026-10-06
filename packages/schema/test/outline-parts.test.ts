import { describe, expect, it } from 'vitest';

import {
  ErrorCodes,
  LAYOUTS_FOR_KIND,
  partKeysForStep,
  partValue,
  resolveRevealOrder,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineStep,
} from '../src/index.js';

/**
 * deck-editor step contract: `layout`, `reveal`, `breakoutOf`. One valid case per
 * field and one case per distinct rejection reason, plus the part-key derivation
 * the deck editor UI and the validator both depend on.
 */

const choice: Interaction = {
  id: 'past-tense',
  type: 'choice',
  prompt: 'Choose the correct sentence.',
  options: [
    { id: 'a', label: "J'ai raté le train.", correct: true },
    { id: 'b', label: 'Je rate le train hier.' },
  ],
};

const fillTheGaps: Interaction = {
  id: 'gap-avoir',
  type: 'fill-the-gaps',
  prompt: "J'{{g1}} raté le {{g2}}.",
  gaps: [
    { id: 'g1', answers: ['ai'] },
    { id: 'g2', answers: ['train'] },
  ],
};

const pairs: Interaction = {
  id: 'pair-words',
  type: 'match',
  prompt: 'Match each word to its meaning.',
  left: [
    { id: 'l1', label: 'le quai' },
    { id: 'l2', label: 'le billet' },
  ],
  right: [
    { id: 'r1', label: 'the platform' },
    { id: 'r2', label: 'the ticket' },
  ],
  correct: { l1: 'r1', l2: 'r2' },
};

function outlineWith(steps: OutlineStep[]): Outline {
  return {
    version: 1,
    meta: { title: 'Travel problems' },
    steps,
    interactions: [choice],
  };
}

/** Validate `steps` and return the errors (empty when valid). */
function errorsFor(steps: OutlineStep[]) {
  const result = validateOutline(outlineWith(steps));
  return result.ok ? [] : result.errors;
}

const term: OutlineStep = {
  id: 'phrase',
  kind: 'term',
  term: 'rater le train',
  meaning: 'to miss the train',
  example: "J'ai raté le train.",
};

describe('partKeysForStep — derived from the step, not authored', () => {
  it('title: header, and body only when there is body text', () => {
    expect(partKeysForStep({ id: 'a', kind: 'title', title: 'T' })).toEqual(['header']);
    expect(partKeysForStep({ id: 'a', kind: 'title', title: 'T', body: 'B' })).toEqual([
      'header',
      'body',
    ]);
  });

  it('statement: the stat is its own part, and there is no header without a title', () => {
    // The stage draws stat → title → body. A statement with no title draws no
    // heading, so a `header` part here would gate an empty screen.
    expect(partKeysForStep({ id: 'a', kind: 'statement', body: 'B' })).toEqual(['body']);
    expect(partKeysForStep({ id: 'a', kind: 'statement', title: 'T', body: 'B' })).toEqual([
      'header',
      'body',
    ]);
    // "Here is the claim … here is the number" is the reason to sequence one.
    expect(
      partKeysForStep({ id: 'a', kind: 'statement', title: 'T', stat: '45', body: 'B' }),
    ).toEqual(['header', 'stat', 'body']);
  });

  it('cards and steps: one cell per item', () => {
    expect(
      partKeysForStep({ id: 'a', kind: 'cards', title: 'T', items: [{ text: 'x' }, { text: 'y' }] }),
    ).toEqual(['header', 'cell-0', 'cell-1']);
    expect(partKeysForStep({ id: 'a', kind: 'steps', title: 'T', items: ['x', 'y', 'z'] })).toEqual([
      'header',
      'cell-0',
      'cell-1',
      'cell-2',
    ]);
  });

  it('term: header, meaning as body, and the optional example as a trailing cell', () => {
    expect(partKeysForStep(term)).toEqual(['header', 'body', 'cell-0']);
    expect(
      partKeysForStep({ id: 'a', kind: 'term', term: 't', meaning: 'm' }),
    ).toEqual(['header', 'body']);
  });

  it('activity: a cell per instruction, and materials as one part when present', () => {
    expect(
      partKeysForStep({ id: 'a', kind: 'activity', title: 'T', instructions: ['do it'] }),
    ).toEqual(['header', 'cell-0']);
    expect(
      partKeysForStep({
        id: 'a',
        kind: 'activity',
        title: 'T',
        instructions: ['do it'],
        materials: ['handout', 'pen'],
      }),
    ).toEqual(['header', 'cell-0', 'materials']);
  });

  it('activity: a picture beside the instructions is an image part, last', () => {
    const media = { type: 'image', url: 'https://example.test/a.png', alt: 'a tower' } as const;
    expect(
      partKeysForStep({ id: 'a', kind: 'activity', title: 'T', instructions: ['do it'], media }),
    ).toEqual(['header', 'cell-0', 'image']);
    expect(
      partKeysForStep({
        id: 'a',
        kind: 'activity',
        title: 'T',
        instructions: ['do it'],
        materials: ['pen'],
        media,
      }),
    ).toEqual(['header', 'cell-0', 'materials', 'image']);
  });

  it('media: the image region, and a header only when a title is authored', () => {
    const media = { type: 'image', url: 'https://example.test/a.png', alt: 'a' } as const;
    expect(partKeysForStep({ id: 'a', kind: 'media', media })).toEqual(['image']);
    expect(partKeysForStep({ id: 'a', kind: 'media', title: 'T', media })).toEqual([
      'header',
      'image',
    ]);
  });

  it('debrief, timer and break derive from their own shapes', () => {
    expect(partKeysForStep({ id: 'a', kind: 'debrief', title: 'T', prompts: ['p', 'q'] })).toEqual([
      'header',
      'cell-0',
      'cell-1',
    ]);
    // A bare countdown has no heading to reveal; the clock is the whole step.
    expect(partKeysForStep({ id: 'a', kind: 'timer', seconds: 60 })).toEqual([]);
    expect(partKeysForStep({ id: 'a', kind: 'timer', title: 'T', seconds: 60 })).toEqual(['header']);
    expect(partKeysForStep({ id: 'a', kind: 'break', title: 'T', body: 'B' })).toEqual([
      'header',
      'body',
    ]);
    // A join slide is just the session's QR — no authored parts to reveal.
    expect(partKeysForStep({ id: 'a', kind: 'join' })).toEqual([]);
  });

  it('interaction: one option key per option of the referenced interaction', () => {
    const step: OutlineStep = { id: 'a', kind: 'interaction', interactionId: 'past-tense' };
    expect(partKeysForStep(step, [choice])).toEqual(['header', 'option-0', 'option-1']);
    // Without the interactions the options cannot be known — no invented keys.
    expect(partKeysForStep(step)).toEqual(['header']);
  });

  it('interaction: a fill-the-gaps gets one gap key per gap, a match one option key per left item', () => {
    const fillTheGapsStep: OutlineStep = { id: 'a', kind: 'interaction', interactionId: 'gap-avoir' };
    expect(partKeysForStep(fillTheGapsStep, [fillTheGaps])).toEqual(['header', 'gap-0', 'gap-1']);
    const matchStep: OutlineStep = { id: 'b', kind: 'interaction', interactionId: 'pair-words' };
    expect(partKeysForStep(matchStep, [pairs])).toEqual(['header', 'option-0', 'option-1']);
  });
});

describe('resolveRevealOrder', () => {
  it("'together' and an absent reveal both mean one group of everything", () => {
    expect(resolveRevealOrder(term)).toEqual([['header', 'body', 'cell-0']]);
    expect(resolveRevealOrder({ ...term, reveal: 'together' })).toEqual([
      ['header', 'body', 'cell-0'],
    ]);
  });

  it('honours the authored order', () => {
    expect(
      resolveRevealOrder({ ...term, reveal: [['header'], ['body'], ['cell-0']] }),
    ).toEqual([['header'], ['body'], ['cell-0']]);
  });

  it('appends parts the author never placed as trailing groups', () => {
    expect(resolveRevealOrder({ ...term, reveal: [['body']] })).toEqual([
      ['body'],
      ['header'],
      ['cell-0'],
    ]);
  });

  it('every part appears exactly once in the resolved order', () => {
    const resolved = resolveRevealOrder({ ...term, reveal: [['cell-0', 'header']] });
    expect(resolved.flat().sort()).toEqual(['body', 'cell-0', 'header']);
  });

  it('a step with no revealable parts yields no groups, not one empty group', () => {
    // A bare countdown is just the clock. `[[]]` would make a caller stepping
    // through the order land on a group that reveals nothing.
    expect(resolveRevealOrder({ id: 'a', kind: 'timer', seconds: 60 })).toEqual([]);
    expect(resolveRevealOrder({ id: 'a', kind: 'join' })).toEqual([]);
  });
});

describe('layout — a kind may only claim a layout it can fill', () => {
  it('accepts every layout the table allows for the kind', () => {
    expect(LAYOUTS_FOR_KIND.term).toContain('split');
    expect(errorsFor([{ ...term, layout: 'split' }])).toEqual([]);
  });

  it('rejects poll on a term step, naming the step, the kind and the alternatives', () => {
    const errors = errorsFor([{ ...term, layout: 'poll' }]);
    const error = errors.find((e) => e.code === ErrorCodes.E_LAYOUT_MISMATCH);
    expect(error).toBeDefined();
    expect(error?.path).toBe('/steps/0/layout');
    expect(error?.message).toContain('"phrase"');
    expect(error?.message).toContain('"term"');
    expect(error?.message).toContain('title, text, split');
  });

  it('rejects timer on a cards step', () => {
    const errors = errorsFor([
      { id: 'c', kind: 'cards', title: 'T', items: [{ text: 'a' }, { text: 'b' }], layout: 'timer' },
    ]);
    expect(errors.some((e) => e.code === ErrorCodes.E_LAYOUT_MISMATCH)).toBe(true);
  });
});

describe('reveal — every rejection reason', () => {
  it('accepts an ordered partial reveal over real parts', () => {
    expect(errorsFor([{ ...term, reveal: [['header'], ['body']] }])).toEqual([]);
  });

  it('rejects a part key the step does not have', () => {
    const errors = errorsFor([{ ...term, reveal: [['header'], ['option-0']] }]);
    const error = errors.find((e) => e.code === ErrorCodes.E_REVEAL);
    expect(error?.path).toBe('/steps/0/reveal/1');
    expect(error?.message).toContain('option-0');
  });

  it('rejects the same part twice', () => {
    const errors = errorsFor([{ ...term, reveal: [['header'], ['body'], ['body']] }]);
    const error = errors.find((e) => e.code === ErrorCodes.E_REVEAL);
    expect(error?.message).toContain('more than once');
  });

  it('rejects an empty group at the schema layer', () => {
    const result = validateOutline(outlineWith([{ ...term, reveal: [[]] } as OutlineStep]));
    expect(result.ok).toBe(false);
  });
});

describe('breakoutOf — every rejection reason', () => {
  const parent: OutlineStep = { ...term, id: 'phrase' };
  const detail = (breakoutOf: { stepId: string; afterKey: string }): OutlineStep => ({
    id: 'why-avoir',
    kind: 'statement',
    body: 'Rater takes a direct object.',
    breakoutOf,
  });

  it('accepts a one-level breakout attached to a real part of its parent', () => {
    expect(errorsFor([parent, detail({ stepId: 'phrase', afterKey: 'cell-0' })])).toEqual([]);
  });

  it('rejects a breakout whose parent does not exist', () => {
    const errors = errorsFor([parent, detail({ stepId: 'nowhere', afterKey: 'header' })]);
    const error = errors.find((e) => e.code === ErrorCodes.E_UNKNOWN_REFERENCE);
    expect(error?.path).toBe('/steps/1/breakoutOf/stepId');
  });

  it('rejects an afterKey the parent does not have', () => {
    const errors = errorsFor([parent, detail({ stepId: 'phrase', afterKey: 'option-0' })]);
    const error = errors.find((e) => e.code === ErrorCodes.E_BREAKOUT);
    expect(error?.path).toBe('/steps/1/breakoutOf/afterKey');
    expect(error?.message).toContain('header, body, cell-0');
  });

  it('rejects a breakout of a breakout — one level only', () => {
    const errors = errorsFor([
      parent,
      detail({ stepId: 'phrase', afterKey: 'cell-0' }),
      {
        id: 'deeper',
        kind: 'statement',
        body: 'Too deep.',
        breakoutOf: { stepId: 'why-avoir', afterKey: 'header' },
      },
    ]);
    const error = errors.find((e) => e.code === ErrorCodes.E_BREAKOUT);
    expect(error?.message).toContain('one level only');
  });

  it('rejects a step that is its own breakout parent', () => {
    const errors = errorsFor([{ ...parent, breakoutOf: { stepId: 'phrase', afterKey: 'header' } }]);
    const error = errors.find((e) => e.code === ErrorCodes.E_BREAKOUT);
    expect(error?.message).toContain('cycle');
  });

  it('rejects a two-step breakout cycle', () => {
    const errors = errorsFor([
      { ...parent, breakoutOf: { stepId: 'why-avoir', afterKey: 'header' } },
      detail({ stepId: 'phrase', afterKey: 'header' }),
    ]);
    expect(errors.filter((e) => e.code === ErrorCodes.E_BREAKOUT).length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('cycle'))).toBe(true);
  });
});

describe('media.focal, media.aspect and activity.materials', () => {
  it('accepts a named focal point and rejects anything outside the nine', () => {
    const step = (focal: string): OutlineStep =>
      ({
        id: 'photo',
        kind: 'media',
        media: { type: 'image', url: 'https://example.test/a.png', alt: 'a', focal },
      }) as unknown as OutlineStep;
    expect(errorsFor([step('bottom-right')])).toEqual([]);
    expect(errorsFor([step('42% 18%')]).length).toBeGreaterThan(0);
  });

  it('accepts a named aspect and rejects free numbers or CSS', () => {
    const step = (aspect: string): OutlineStep =>
      ({
        id: 'clip',
        kind: 'media',
        media: { type: 'video', url: 'https://example.test/a.mp4', alt: 'a', aspect },
      }) as unknown as OutlineStep;
    expect(errorsFor([step('16:9')])).toEqual([]);
    expect(errorsFor([step('9:16')])).toEqual([]);
    expect(errorsFor([step('1.777')]).length).toBeGreaterThan(0);
    expect(errorsFor([step('widescreen')]).length).toBeGreaterThan(0);
  });

  it('accepts place and size and rejects a size outside 20–100', () => {
    const step = (place: string, size: number): OutlineStep =>
      ({
        id: 'photo',
        kind: 'media',
        media: { type: 'image', url: 'https://example.test/a.png', alt: 'a', place, size },
      }) as unknown as OutlineStep;
    expect(errorsFor([step('left', 30)])).toEqual([]);
    expect(errorsFor([step('fill', 100)])).toEqual([]);
    expect(errorsFor([step('beside', 30)]).length).toBeGreaterThan(0);
    expect(errorsFor([step('left', 5)]).length).toBeGreaterThan(0);
  });

  it('allows the stacked text layout on a media step', () => {
    const step: OutlineStep = {
      id: 'clip',
      kind: 'media',
      title: 'Watch this',
      layout: 'text',
      media: { type: 'video', url: 'https://example.test/a.mp4', alt: 'clip', aspect: '9:16' },
    };
    expect(errorsFor([step])).toEqual([]);
  });

  it('accepts named timer styles and rejects free CSS', () => {
    const step = (style: string): OutlineStep =>
      ({
        id: 'think',
        kind: 'timer',
        seconds: 60,
        style,
      }) as unknown as OutlineStep;
    expect(errorsFor([step('countdown')])).toEqual([]);
    expect(errorsFor([step('countup')])).toEqual([]);
    expect(errorsFor([step('bar-empty')])).toEqual([]);
    expect(errorsFor([step('bar-fill')])).toEqual([]);
    expect(errorsFor([step('hourglass')])).toEqual([]);
    expect(errorsFor([step('ring')])).toEqual([]);
    expect(errorsFor([step('spinning-pizza')]).length).toBeGreaterThan(0);
  });

  it('accepts materials beside instructions and exposes them as their own part', () => {
    const step: OutlineStep = {
      id: 'role-play',
      kind: 'activity',
      title: 'At the desk',
      instructions: ['Explain what happened.'],
      materials: ['Timetable handout'],
      reveal: [['header'], ['materials'], ['cell-0']],
    };
    expect(errorsFor([step])).toEqual([]);
  });
});

describe('partValue — the text behind a part key', () => {
  it('term: the heading is the term itself, the body is the meaning, cell-0 the example', () => {
    // A term carries no `title`, so reading its header as a title would hand the
    // authoring surface an empty box over a heading the stage clearly draws.
    expect(partValue(term, 'header')).toBe('rater le train');
    expect(partValue(term, 'body')).toBe('to miss the train');
    expect(partValue(term, 'cell-0')).toBe("J'ai raté le train.");
    expect(partValue(term, 'cell-1')).toBeUndefined();
    expect(partValue({ id: 'a', kind: 'term', term: 't', meaning: 'm' }, 'cell-0')).toBeUndefined();
  });

  it('activity: cells are instructions and materials is the joined list', () => {
    const step: OutlineStep = {
      id: 'role-play',
      kind: 'activity',
      title: 'At the desk',
      instructions: ['Explain what happened.', 'Ask for the next train.'],
      materials: ['Timetable handout', 'Pen'],
    };
    expect(partValue(step, 'header')).toBe('At the desk');
    expect(partValue(step, 'cell-1')).toBe('Ask for the next train.');
    expect(partValue(step, 'materials')).toBe('Timetable handout\nPen');
    expect(partValue({ ...step, materials: undefined }, 'materials')).toBeUndefined();
    expect(partValue(step, 'image')).toBeUndefined();
    expect(
      partValue(
        { ...step, media: { type: 'image', url: 'https://example.test/a.png', alt: 'a tower' } },
        'image',
      ),
    ).toBe('a tower');
  });

  it('interaction: the header falls back to the prompt, and options need the interactions', () => {
    const step: OutlineStep = { id: 'check', kind: 'interaction', interactionId: 'past-tense' };
    expect(partValue(step, 'header', [choice])).toBe('Choose the correct sentence.');
    expect(partValue({ ...step, title: 'Your turn' }, 'header', [choice])).toBe('Your turn');
    expect(partValue(step, 'option-1', [choice])).toBe('Je rate le train hier.');
    expect(partValue(step, 'option-2', [choice])).toBeUndefined();
    // Without the interactions there is nothing to read; the caller must pass them.
    expect(partValue(step, 'option-0')).toBeUndefined();
  });

  it('interaction: a gap reads as its answer key, a match option as its left label', () => {
    const fillTheGapsStep: OutlineStep = { id: 'a', kind: 'interaction', interactionId: 'gap-avoir' };
    expect(partValue(fillTheGapsStep, 'gap-1', [fillTheGaps])).toBe('train');
    expect(partValue(fillTheGapsStep, 'gap-2', [fillTheGaps])).toBeUndefined();
    expect(partValue(fillTheGapsStep, 'option-0', [fillTheGaps])).toBeUndefined();
    const matchStep: OutlineStep = { id: 'b', kind: 'interaction', interactionId: 'pair-words' };
    expect(partValue(matchStep, 'option-1', [pairs])).toBe('le billet');
    expect(partValue(matchStep, 'gap-0', [pairs])).toBeUndefined();
  });

  it('separates "no such part" from "this part is blank"', () => {
    const statement: OutlineStep = { id: 's', kind: 'statement', body: '' };
    expect(partValue(statement, 'body')).toBe('');
    expect(partValue(statement, 'header')).toBeUndefined();
    expect(partValue(statement, 'materials')).toBeUndefined();
  });
});
