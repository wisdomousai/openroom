import type { ChoiceInteractionView, ScaleInteractionView } from '@openroom/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sortedChoiceOptions, ABSTAIN_KEY } from '../helpers';
import { ChoiceBarsChart } from './bars';
import { ChoicePieChart } from './pie';
import { ScaleBarsChart } from './scale';

/**
 * Abstention is counted in `aggregate.total`, so a display that draws only the
 * authored options draws bars that add up to less than the total it states.
 * What matters: the row exists, it carries the abstainers, it is never the
 * answer key, and it comes last however the rest is sorted.
 */

const choice: ChoiceInteractionView = {
  id: 'q-air',
  type: 'choice',
  prompt: 'Which gas is most of the air?',
  options: [
    { id: 'a', label: 'Oxygen', correct: true },
    { id: 'b', label: 'Nitrogen' },
  ],
};

const counts = { a: 3, b: 1 };
const dontKnow = 2;
const total = 6; // 4 scored + 2 abstained, as packages/domain counts it

describe('abstention row', () => {
  it('makes the bars add up to the stated total', () => {
    const rows = sortedChoiceOptions({ interaction: choice, counts, dontKnow });
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(total);
    expect(rows.at(-1)).toMatchObject({ id: ABSTAIN_KEY, count: 2, abstain: true });
  });

  it('sorts last and is never correct, whatever the sort mode', () => {
    const revealedByVotes: ChoiceInteractionView = {
      ...choice,
      displayOptions: { sortBy: 'votes' },
    };
    // The abstainers outnumber every option, and still do not lead.
    const rows = sortedChoiceOptions({
      interaction: revealedByVotes,
      counts: { a: 1, b: 2 },
      dontKnow: 9,
    });
    expect(rows.map((row) => row.id)).toEqual(['b', 'a', ABSTAIN_KEY]);
    expect(rows.at(-1)?.correct).toBe(false);
  });

  it('is absent when nobody abstained', () => {
    expect(sortedChoiceOptions({ interaction: choice, counts, dontKnow: 0 })).toHaveLength(2);
    const html = renderToStaticMarkup(
      <ChoiceBarsChart
        interaction={choice}
        counts={counts}
        total={4}
        dontKnow={0}
        revealed
      />,
    );
    expect(html).not.toContain('data-or-abstain');
  });

  it('draws its own muted row in the bars display, not marked correct', () => {
    const html = renderToStaticMarkup(
      <ChoiceBarsChart
        interaction={choice}
        counts={counts}
        total={total}
        dontKnow={dontKnow}
        revealed
      />,
    );
    expect(html).toContain('data-or-abstain');
    expect(html).toContain('data-part="dont-know"');
    // Its own bar, painted from the muted role rather than a series colour.
    expect(html).toMatch(
      new RegExp(`choice-bars:[^"]*${ABSTAIN_KEY}" fill="var\\(--muted-foreground\\)"`),
    );
    // The reveal marker belongs to the answer key alone.
    expect(html).not.toMatch(/data-or-abstain=""[^>]*data-or-correct/);
    // Still says how many, in the summary's words.
    expect(html).toContain('2 don&#x27;t know');
  });

  it('names the abstention in the pie legend with its share of the total', () => {
    const html = renderToStaticMarkup(
      <ChoicePieChart
        interaction={choice}
        counts={counts}
        total={total}
        dontKnow={dontKnow}
        revealed={false}
        donut
      />,
    );
    expect(html).toContain('Don&#x27;t know');
    expect(html).toContain('33%'); // 2 of 6
    expect(html).toContain('data-or-abstain');
  });

  it('gives the scale display a band off the end of the scale', () => {
    const scale: ScaleInteractionView = {
      id: 'q-sure',
      type: 'scale',
      prompt: 'How sure are you?',
      min: 1,
      max: 3,
    };
    const html = renderToStaticMarkup(
      <ScaleBarsChart
        interaction={scale}
        counts={{ 1: 1, 2: 2, 3: 1 }}
        total={6}
        mean={2}
        dontKnow={2}
      />,
    );
    expect(html).toContain('2 don&#x27;t know');
    expect(html).toMatch(
      new RegExp(`scale-bars:[^"]*${ABSTAIN_KEY}" fill="var\\(--muted-foreground\\)"`),
    );
  });
});
