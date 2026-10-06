import { describe, expect, it } from 'vitest';

import {
  OUTLINE_STEP_KINDS,
  SLOT_SPANS_FOR_KIND,
  partKeysForStep,
  partSpansTarget,
  validateOutline,
  type Outline,
  type OutlineStep,
} from '../src/index.js';

/**
 * Styled spans on a step's fixed slots.
 *
 * The table in `SLOT_SPANS_FOR_KIND` is the single answer to "which text of this
 * kind can carry styling"; the validator and the editor both read it, so what
 * is pinned here is that the table covers every kind, that the concat invariant
 * is enforced on slots exactly as it is on elements, and that the two kinds
 * whose stored text is not their drawn text carry no spans at all.
 */

function deck(step: OutlineStep, interactions?: Outline['interactions']): Outline {
  return {
    version: 1,
    meta: { title: 'Spans on slots' },
    steps: [step],
    interactions: interactions ?? [
      { id: 'check', type: 'choice', prompt: 'Choose.', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    ],
  };
}

function errorsOf(outline: unknown): string[] {
  const result = validateOutline(outline);
  return result.ok ? [] : result.errors.map((error) => error.path);
}

describe('SLOT_SPANS_FOR_KIND', () => {
  it('names a pair of fields for every step kind', () => {
    for (const kind of OUTLINE_STEP_KINDS) {
      expect([kind, Array.isArray(SLOT_SPANS_FOR_KIND[kind])]).toEqual([kind, true]);
    }
  });

  it('leaves the kinds whose stored text is not their drawn text out', () => {
    expect(SLOT_SPANS_FOR_KIND.timer).toEqual([]);
    expect(SLOT_SPANS_FOR_KIND.join).toEqual([]);
  });

  it('names only fields the kind actually has', () => {
    const fields: Record<string, string[]> = {
      title: ['title', 'body'],
      statement: ['title', 'body', 'stat'],
      cards: ['title'],
      steps: ['title'],
      term: ['term', 'meaning', 'example'],
      activity: ['title'],
      timer: [],
      media: ['title'],
      debrief: ['title'],
      break: ['title', 'body'],
      join: [],
      blank: ['title'],
      interaction: ['title', 'body'],
    };
    for (const kind of OUTLINE_STEP_KINDS) {
      expect([kind, SLOT_SPANS_FOR_KIND[kind].map((slot) => slot.textField)]).toEqual([
        kind,
        fields[kind],
      ]);
      for (const slot of SLOT_SPANS_FOR_KIND[kind]) {
        expect(slot.spansField).toBe(`${slot.textField}Spans`);
      }
    }
  });
});

describe('partSpansTarget', () => {
  const cases: { step: OutlineStep; key: 'header' | 'body' | 'stat'; spansField: string | null }[] = [
    { step: { id: 's', kind: 'title', title: 'T' }, key: 'header', spansField: 'titleSpans' },
    { step: { id: 's', kind: 'title', title: 'T', body: 'B' }, key: 'body', spansField: 'bodySpans' },
    { step: { id: 's', kind: 'statement', body: 'B', stat: '40%' }, key: 'stat', spansField: 'statSpans' },
    { step: { id: 's', kind: 'term', term: 'T', meaning: 'M' }, key: 'header', spansField: 'termSpans' },
    { step: { id: 's', kind: 'term', term: 'T', meaning: 'M' }, key: 'body', spansField: 'meaningSpans' },
    { step: { id: 's', kind: 'timer', seconds: 60, title: '{timer-minutes}' }, key: 'header', spansField: null },
    { step: { id: 's', kind: 'timer', seconds: 60, body: 'Work' }, key: 'body', spansField: null },
    { step: { id: 's', kind: 'join' }, key: 'header', spansField: null },
    { step: { id: 's', kind: 'cards', title: 'T', items: [{ text: 'a' }, { text: 'b' }] }, key: 'body', spansField: null },
    { step: { id: 's', kind: 'interaction', interactionId: 'check' }, key: 'header', spansField: null },
    {
      step: { id: 's', kind: 'interaction', interactionId: 'check', title: 'Own' },
      key: 'header',
      spansField: 'titleSpans',
    },
  ];

  it('routes each span-capable part to the field that stores its styling', () => {
    for (const { step, key, spansField } of cases) {
      expect([step.kind, key, partSpansTarget(step, key)?.spansField ?? null]).toEqual([
        step.kind,
        key,
        spansField,
      ]);
    }
  });

  it('never claims a part the step does not have', () => {
    for (const { step, key } of cases) {
      const target = partSpansTarget(step, key);
      if (target === null) continue;
      expect([step.kind, key, partKeysForStep(step).includes(key) || key === 'header']).toEqual([
        step.kind,
        key,
        true,
      ]);
    }
  });
});

describe('validation', () => {
  it('accepts styled spans on a slot whose concatenation matches its text', () => {
    const outline = deck({
      id: 'lede',
      kind: 'title',
      title: 'Le passé',
      titleSpans: [{ text: 'Le ' }, { text: 'passé', bold: true }],
    });
    expect(errorsOf(outline)).toEqual([]);
  });

  it('rejects slot spans that do not concatenate to the slot text', () => {
    const outline = deck({
      id: 'lede',
      kind: 'title',
      title: 'Le passé',
      titleSpans: [{ text: 'Le futur' }],
    });
    expect(errorsOf(outline)).toContain('/steps/0/titleSpans');
  });

  it('rejects an empty span', () => {
    const outline = deck({
      id: 'lede',
      kind: 'statement',
      body: 'Deux',
      bodySpans: [{ text: '' }, { text: 'Deux' }],
    });
    // minItems / minLength keeps it out at the schema layer too; either way the
    // document does not validate.
    expect(errorsOf(outline).length).toBeGreaterThan(0);
  });

  it('accepts styled spans on an interaction prompt', () => {
    const outline = deck(
      { id: 'q', kind: 'interaction', interactionId: 'check' },
      [
        {
          id: 'check',
          type: 'choice',
          prompt: 'Choose one.',
          promptSpans: [{ text: 'Choose ' }, { text: 'one.', bold: true }],
          options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        },
      ],
    );
    expect(errorsOf(outline)).toEqual([]);
  });

  it('rejects styled spans on a fill-the-gaps prompt', () => {
    const outline = deck(
      { id: 'q', kind: 'interaction', interactionId: 'gaps' },
      [
        {
          id: 'gaps',
          type: 'fill-the-gaps',
          prompt: "J'{{g1}} raté le train.",
          promptSpans: [{ text: "J'{{g1}} raté le train." }],
          gaps: [{ id: 'g1', answers: ['ai'] }],
        },
      ],
    );
    expect(errorsOf(outline)).toContain('/interactions/0/promptSpans');
  });

  it('leaves a plain deck with no span fields valid', () => {
    expect(errorsOf(deck({ id: 'lede', kind: 'title', title: 'Le passé' }))).toEqual([]);
  });

  it('refuses span fields on a timer, which the schema never declares', () => {
    const outline = {
      ...deck({ id: 'clock', kind: 'timer', seconds: 600, title: '{timer-minutes} minutes' }),
    } as unknown as { steps: Record<string, unknown>[] };
    outline.steps[0]!['titleSpans'] = [{ text: '{timer-minutes} minutes' }];
    expect(errorsOf(outline).length).toBeGreaterThan(0);
  });
});
