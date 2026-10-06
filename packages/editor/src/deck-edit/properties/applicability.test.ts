/**
 * What the properties pane is allowed to show.
 *
 * The pane shows the slide's own properties when nothing is selected, and the
 * selection's properties when something is. Both halves are pinned here across
 * every step kind, so a new kind cannot quietly inherit a section it has no
 * content for — and a one-option control cannot come back.
 */
import {
  OUTLINE_STEP_KINDS,
  kindCanCarryElements,
  kindCanCarryPicture,
  resolveRevealOrder,
  validateOutline,
  type Interaction,
  type Outline,
  type OutlineStep,
  type OutlineStepKind,
} from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { layoutChoicesFor, paneSections, paneSelection } from './applicability';

const PICTURE = { type: 'image', url: 'https://example.test/a.png', alt: 'A tower' } as const;

const INTERACTION: Interaction = {
  id: 'past-tense',
  type: 'choice',
  prompt: 'Choose the correct sentence.',
  options: [
    { id: 'a', label: "J'ai raté le train." },
    { id: 'b', label: 'Je rate le train hier.' },
  ],
} as Interaction;

/** One representative step per kind, each with the parts its kind can carry. */
const STEPS: Record<OutlineStepKind, OutlineStep> = {
  title: { id: 'k', kind: 'title', title: 'Les voyages', body: 'Tell a short story.' },
  statement: { id: 'k', kind: 'statement', title: 'The claim', body: 'Two thirds.', stat: '66%' },
  cards: { id: 'k', kind: 'cards', title: 'Four things', items: [{ text: 'One' }, { text: 'Two' }] },
  steps: { id: 'k', kind: 'steps', title: 'How to', items: ['One', 'Two'] },
  term: { id: 'k', kind: 'term', term: 'Voyage', meaning: 'A journey.' },
  activity: {
    id: 'k',
    kind: 'activity',
    title: 'Build the tallest tower',
    instructions: ['Form groups of four'],
    durationSec: 600,
  },
  timer: { id: 'k', kind: 'timer', title: 'Two minutes', body: 'Compare answers.', seconds: 120 },
  media: { id: 'k', kind: 'media', title: 'The tower', media: PICTURE },
  debrief: { id: 'k', kind: 'debrief', title: 'À retenir', prompts: ['What changed?'] },
  break: { id: 'k', kind: 'break', title: 'Break', body: 'Back in five.', minutes: 5 },
  join: { id: 'k', kind: 'join' },
  blank: {
    id: 'k',
    kind: 'blank',
    title: 'Canvas',
    elements: [
      { id: 'e1', type: 'text', text: 'A box', box: { x: 10, y: 10, w: 30, h: 10 } },
      { id: 'e2', type: 'text', text: 'Another', box: { x: 10, y: 30, w: 30, h: 10 } },
    ],
  } as OutlineStep,
  interaction: { id: 'k', kind: 'interaction', interactionId: 'past-tense' },
};

function outlineOf(step: OutlineStep): Outline {
  return {
    version: 1,
    meta: { title: 'Day 1' },
    steps: [step],
    interactions: [INTERACTION],
  };
}

function sectionsFor(step: OutlineStep, partKey: string | null) {
  return paneSections({ step, partKey, groups: resolveRevealOrder(step, [INTERACTION]) });
}

const KINDS = OUTLINE_STEP_KINDS;

describe('properties pane fixtures', () => {
  it('has a valid step for every kind', () => {
    expect([...KINDS].sort()).toEqual(Object.keys(STEPS).sort());
    for (const kind of KINDS) {
      const result = validateOutline(outlineOf(STEPS[kind]));
      expect([kind, result.ok ? [] : result.errors.map((error) => error.message)]).toEqual([
        kind,
        [],
      ]);
    }
  });
});

describe('paneSelection', () => {
  it('names what the part key points at', () => {
    expect(paneSelection(null)).toBe('slide');
    expect(paneSelection('image')).toBe('picture');
    expect(paneSelection('el-e1')).toBe('element');
    expect(paneSelection('header')).toBe('part');
    expect(paneSelection('cell-0')).toBe('part');
  });
});

describe('layout picker', () => {
  it('offers a layout only where the kind has more than one', () => {
    for (const kind of KINDS) {
      const many = layoutChoicesFor(kind).length > 1;
      expect([kind, sectionsFor(STEPS[kind], null).layout]).toEqual([kind, many]);
    }
  });

  it('drops the one-option pickers a single-layout kind would show', () => {
    expect(layoutChoicesFor('blank')).toEqual(['blank']);
    expect(layoutChoicesFor('join')).toEqual(['join']);
    expect(sectionsFor(STEPS.blank, null).layout).toBe(false);
    expect(sectionsFor(STEPS.join, null).layout).toBe(false);
  });
});

describe('slide-level sections', () => {
  it('times only the kinds that carry a duration', () => {
    const timed = KINDS.filter((kind) => sectionsFor(STEPS[kind], null).timing);
    expect([...timed].sort()).toEqual(['activity', 'break', 'timer']);
  });

  it('authors a clock only on a timer', () => {
    const clocks = KINDS.filter((kind) => sectionsFor(STEPS[kind], null).timerAuthoring);
    expect(clocks).toEqual(['timer']);
  });

  it('orders a reveal only where two or more parts exist', () => {
    for (const kind of KINDS) {
      const parts = resolveRevealOrder(STEPS[kind], [INTERACTION]).flat().length;
      expect([kind, sectionsFor(STEPS[kind], null).reveal]).toEqual([kind, parts > 1]);
    }
    // A join has no parts at all, and an empty canvas has only its title.
    expect(sectionsFor(STEPS.join, null).reveal).toBe(false);
    expect(sectionsFor({ id: 'k', kind: 'blank', title: 'Canvas' }, null).reveal).toBe(false);
  });

  it('replaces a join slide with its own note and nothing else', () => {
    const sections = sectionsFor(STEPS.join, null);
    expect(sections).toEqual({
      join: true,
      layout: false,
      timing: false,
      timerAuthoring: false,
      reveal: false,
      picture: false,
      element: false,
      part: false,
    });
  });
});

describe('a selected part hides the slide-level sections', () => {
  it('shows the part alone', () => {
    for (const kind of KINDS) {
      const step = STEPS[kind];
      for (const key of resolveRevealOrder(step, [INTERACTION]).flat()) {
        const sections = sectionsFor(step, key);
        const shown = Object.entries(sections)
          .filter(([, on]) => on)
          .map(([name]) => name);
        expect([kind, key, shown.length]).toEqual([kind, key, 1]);
        expect([kind, key, sections.layout || sections.timing || sections.reveal]).toEqual([
          kind,
          key,
          false,
        ]);
      }
    }
  });
});

describe('picture section', () => {
  it('shows only where the kind carries a picture and one is set', () => {
    for (const kind of KINDS) {
      const step = STEPS[kind];
      const carries = kindCanCarryPicture(kind);
      const withPicture = carries
        ? ({ ...step, media: PICTURE } as OutlineStep)
        : step;
      expect([kind, sectionsFor(withPicture, 'image').picture]).toEqual([kind, carries]);
      // No picture set on a kind that could carry one: still nothing to show.
      if (kind !== 'media') {
        expect([kind, sectionsFor(step, 'image').picture]).toEqual([kind, false]);
      }
    }
  });
});

describe('element section', () => {
  it('shows only for an element the kind actually carries', () => {
    expect(kindCanCarryElements('blank')).toBe(true);
    expect(sectionsFor(STEPS.blank, 'el-e1').element).toBe(true);
    expect(sectionsFor(STEPS.blank, 'el-gone').element).toBe(false);
    for (const kind of KINDS) {
      if (kindCanCarryElements(kind)) continue;
      expect([kind, sectionsFor(STEPS[kind], 'el-e1').element]).toEqual([kind, false]);
    }
  });
});
