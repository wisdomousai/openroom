import { describe, expect, it } from 'vitest';

import {
  defaultDeckDesign,
  validateOutline,
  type DeckAspectRatio,
  type DeckDesign,
  type Interaction,
  type OutlineStep,
  type OutlineWarning,
} from '../src/index.js';

/**
 * Advisory warnings on a valid outline. The text cases are the clipping points
 * measured on the stage wall in the 2026-11-06 slide layout review: content on
 * one side of each pair fits, the other is cut or runs into the margin.
 */

const choice: Interaction = {
  id: 'q1',
  type: 'choice',
  prompt: 'Nous ___ au zoo.',
  options: [
    { id: 'a', label: 'sommes allés', correct: true },
    { id: 'b', label: 'allons' },
  ],
};

function design(aspect: DeckAspectRatio = '16:9', safeArea = 8, master: Partial<DeckDesign['masters'][number]> = {}): DeckDesign {
  const deck = defaultDeckDesign();
  deck.aspectRatio = aspect;
  deck.masters = [{ ...deck.masters[0]!, safeArea, ...master }];
  return deck;
}

function check(step: OutlineStep, deck: DeckDesign = design()): { warnings: OutlineWarning[]; layouts: string[] } {
  const result = validateOutline({ version: 1, meta: { title: 'Le zoo' }, design: deck, steps: [step], interactions: [choice] });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return { warnings: result.warnings ?? [], layouts: result.layouts ?? [] };
}

const codes = (step: OutlineStep, deck?: DeckDesign) => check(step, deck).warnings.map((warning) => warning.code);

/** Prose of exactly `length` characters, in words, as a slide would carry it. */
function prose(length: number): string {
  let text = '';
  while (text.length < length) text += 'les animaux ';
  return text.slice(0, length);
}

describe('W_TEXT_FIT: words taller than their slide', () => {
  const statement = (length: number): OutlineStep => ({ id: 's', kind: 'statement', title: 'Le zoo', body: prose(length) });

  it('passes a 250-character statement and flags 350 at 16:9, which fits at 4:3', () => {
    expect(codes(statement(250))).toEqual([]);
    expect(codes(statement(350))).toEqual(['W_TEXT_FIT']);
    expect(codes(statement(350), design('4:3'))).toEqual([]);
  });

  it('flags a 150-character title at 16:9 and 16:10 but not at 4:3', () => {
    const title: OutlineStep = { id: 't', kind: 'title', title: prose(150) };
    expect(codes({ ...title, title: prose(60) })).toEqual([]);
    expect(codes(title)).toEqual(['W_TEXT_FIT']);
    expect(codes(title, design('16:10'))).toEqual(['W_TEXT_FIT']);
    expect(codes(title, design('4:3'))).toEqual([]);
  });

  it('passes four cards of 100 characters and flags eight of 40, whose cells cut them', () => {
    const cards = (count: number, length: number): OutlineStep => ({
      id: 'c',
      kind: 'cards',
      title: 'Les animaux',
      items: Array.from({ length: count }, () => ({ text: prose(length) })),
    });
    expect(codes(cards(4, 100))).toEqual([]);
    const [warning] = check(cards(8, 40)).warnings;
    expect(warning).toMatchObject({ code: 'W_TEXT_FIT', path: '/steps/0', layout: 'grid' });
    expect(warning!.message).toContain('will be cut');
  });

  it('holds six short steps on the text layout and flags a seventh', () => {
    const steps = (count: number): OutlineStep => ({
      id: 's',
      kind: 'steps',
      title: 'Au zoo',
      layout: 'text',
      items: Array.from({ length: count }, () => prose(40)),
    });
    expect(codes(steps(6))).toEqual([]);
    expect(codes(steps(7))).toEqual(['W_TEXT_FIT']);
  });

  it('flags five debrief prompts of 90 characters', () => {
    expect(codes({ id: 'd', kind: 'debrief', title: 'À retenir', prompts: Array.from({ length: 5 }, () => prose(90)) })).toEqual([
      'W_TEXT_FIT',
    ]);
  });

  it('scales with the safe area: a statement that fits a margin of 8 runs into a margin of 12', () => {
    expect(codes(statement(300))).toEqual([]);
    const [warning] = check(statement(300), design('16:9', 12)).warnings;
    expect(warning?.code).toBe('W_TEXT_FIT');
    expect(warning!.message).toContain('bottom margin');
  });
});

describe('W_MEDIA_PLACE and W_MEDIA_SIZE: pictures the layout redraws', () => {
  const picture = (extra: Record<string, unknown>) => ({ type: 'image' as const, url: 'https://example.test/zoo.png', alt: 'A zoo', ...extra });

  it('draws left or right on a stacked layout as split and says so', () => {
    const result = check({ id: 's', kind: 'statement', body: 'Le zoo', media: picture({ place: 'right' }) });
    expect(result.layouts).toEqual(['split']);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'W_MEDIA_PLACE', path: '/steps/0/media/place', layout: 'split' })]);
  });

  it('flags top and bottom on split, which draw as right', () => {
    expect(codes({ id: 's', kind: 'statement', body: 'Le zoo', layout: 'split', media: picture({ place: 'top' }) })).toEqual(['W_MEDIA_PLACE']);
  });

  it('flags fill on split, which leaves no column for the words', () => {
    expect(codes({ id: 's', kind: 'statement', body: 'Le zoo', layout: 'split', media: picture({ place: 'fill' }) })).toEqual(['W_MEDIA_PLACE']);
  });

  it('flags a split picture wider than 60 and passes one of 50', () => {
    const split = (size: number): OutlineStep => ({ id: 's', kind: 'statement', body: 'Le zoo', layout: 'split', media: picture({ place: 'left', size }) });
    expect(codes(split(50))).toEqual([]);
    expect(codes(split(80))).toEqual(['W_MEDIA_SIZE']);
  });

  it('says nothing about the places a layout honours', () => {
    expect(codes({ id: 's', kind: 'statement', body: 'Le zoo', media: picture({ place: 'bottom', size: 40 }) })).toEqual([]);
    expect(codes({ id: 'm', kind: 'media', title: 'Le zoo', media: picture({}) })).toEqual([]);
  });
});

describe('W_ELEMENT_BOUNDS and W_ELEMENT_OVERLAP: boxes past the edge or over furniture', () => {
  const text = (box: { x: number; y: number; w: number; h: number }) => ({ id: 'note', type: 'text' as const, text: 'Le zoo', box });

  it('flags a box that runs past the right or bottom edge', () => {
    expect(codes({ id: 'b', kind: 'blank', elements: [text({ x: 60, y: 10, w: 60, h: 20 })] })).toEqual(['W_ELEMENT_BOUNDS']);
    expect(codes({ id: 'b', kind: 'blank', elements: [text({ x: 10, y: 92, w: 30, h: 20 })] })).toEqual(['W_ELEMENT_BOUNDS']);
    expect(codes({ id: 'b', kind: 'blank', elements: [text({ x: 40, y: 80, w: 60, h: 20 })] })).toEqual([]);
  });

  it("flags a box over a blank step's title and passes one below it", () => {
    expect(codes({ id: 'b', kind: 'blank', title: 'Le zoo', elements: [text({ x: 10, y: 5, w: 50, h: 20 })] })).toEqual(['W_ELEMENT_OVERLAP']);
    expect(codes({ id: 'b', kind: 'blank', title: 'Le zoo', elements: [text({ x: 10, y: 40, w: 50, h: 20 })] })).toEqual([]);
  });

  it('flags a box under the master logo only when the master has one', () => {
    const corner: OutlineStep = { id: 'b', kind: 'blank', elements: [text({ x: 80, y: 0, w: 20, h: 10 })] };
    expect(codes(corner)).toEqual([]);
    expect(codes(corner, design('16:9', 8, { logo: { url: 'https://example.test/logo.png', alt: 'School' } }))).toEqual(['W_ELEMENT_OVERLAP']);
  });
});

describe('W_SPAN_SIZE and W_INTERACTION_FIELDS', () => {
  it('flags a styled span under 60 percent', () => {
    const result = check({ id: 't', kind: 'title', title: 'Le zoo', titleSpans: [{ text: 'Le ' }, { text: 'zoo', size: 25 }] });
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'W_SPAN_SIZE', path: '/steps/0/titleSpans/1/size' })]);
    expect(codes({ id: 't', kind: 'title', title: 'Le zoo', titleSpans: [{ text: 'Le zoo', size: 100 }] })).toEqual([]);
  });

  it('names the step fields the live wall does not draw on a question', () => {
    const [warning] = check({ id: 'q', kind: 'interaction', interactionId: 'q1', title: 'Au zoo', body: 'Choisissez.' }).warnings;
    expect(warning).toMatchObject({ code: 'W_INTERACTION_FIELDS', path: '/steps/0' });
    expect(warning!.message).toContain('title, body');
    expect(codes({ id: 'q', kind: 'interaction', interactionId: 'q1' })).toEqual([]);
  });
});
