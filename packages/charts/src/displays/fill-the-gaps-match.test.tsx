import type { FillTheGapsInteractionView, MatchInteractionView } from '@openroom/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GapsChart } from './gaps';
import { PairsChart } from './pairs';
import { AggregateChart } from '../AggregateChart';

/**
 * The two lanes that mark an answer key on screen. What matters is the tally
 * and the reveal marker: an answer must not be flagged correct before the host
 * reveals, and normalization must fold spellings the match policy calls equal.
 */

const fillTheGaps: FillTheGapsInteractionView = {
  id: 'gap-avoir',
  type: 'fill-the-gaps',
  prompt: "J'{{g1}} raté le train.",
  display: 'gaps',
  gaps: [{ id: 'g1' }],
  match: { locale: 'fr', accents: 'ignore' },
};

const revealedFillTheGaps: FillTheGapsInteractionView = {
  ...fillTheGaps,
  gaps: [{ id: 'g1', answers: ['ai'] }],
};

const entries = [
  { participantId: 'p1', gaps: { g1: 'ai' }, hidden: false },
  { participantId: 'p2', gaps: { g1: 'AI' }, hidden: false },
  { participantId: 'p3', gaps: { g1: 'suis' }, hidden: false },
];

const match: MatchInteractionView = {
  id: 'pair-words',
  type: 'match',
  prompt: 'Match each word to its meaning.',
  display: 'pairs',
  left: [
    { id: 'l1', label: 'le quai' },
    { id: 'l2', label: 'le billet' },
  ],
  right: [
    { id: 'r1', label: 'the platform' },
    { id: 'r2', label: 'the ticket' },
  ],
};

const pairs = { l1: { r1: 2, r2: 1 }, l2: { r2: 3 } };

describe('GapsChart', () => {
  it('folds spellings the match policy calls equal into one row', () => {
    const html = renderToStaticMarkup(
      <GapsChart
        interaction={fillTheGaps}
        entries={entries}
        total={3}
        dontKnow={0}
        revealed={false}
      />,
    );
    // "ai" and "AI" are one answer under the interaction's own policy; "suis"
    // is a second. Two rows, not three.
    expect(html.match(/data-or-option=/g)).toHaveLength(2);
    expect(html).not.toContain('data-or-correct');
  });

  it('marks the answer key only once the gap carries its answers', () => {
    const html = renderToStaticMarkup(
      <GapsChart
        interaction={revealedFillTheGaps}
        entries={entries}
        total={3}
        dontKnow={1}
        revealed
      />,
    );
    expect(html.match(/data-or-correct/g)).toHaveLength(1);
    expect(html).toContain('1 don&#x27;t know');
  });

  it('draws nothing from the audience while the session is frozen', () => {
    const html = renderToStaticMarkup(
      <GapsChart
        interaction={revealedFillTheGaps}
        entries={entries}
        total={3}
        dontKnow={0}
        revealed
        frozen
      />,
    );
    expect(html).not.toContain('data-or-option');
    expect(html).toContain('Hidden while paused.');
  });
});

describe('AggregateChart fill-the-gaps displays', () => {
  it('routes bank and choices to GapsChart', () => {
    const aggregate = { kind: 'fill-the-gaps' as const, entries, total: 3, dontKnow: 0 };
    for (const display of ['bank', 'choices'] as const) {
      const html = renderToStaticMarkup(
        <AggregateChart
          interaction={{ ...fillTheGaps, display }}
          aggregate={aggregate}
          revealed={false}
        />,
      );
      expect(html.match(/data-or-option=/g)).toHaveLength(2);
    }
  });
});

describe('PairsChart', () => {
  it('shows each left item with the right items the audience chose', () => {
    const html = renderToStaticMarkup(
      <PairsChart interaction={match} pairs={pairs} total={3} dontKnow={0} revealed={false} />,
    );
    expect(html).toContain('data-or-pair="l1:r1"');
    expect(html).toContain('data-or-pair="l1:r2"');
    expect(html).toContain('data-or-pair="l2:r2"');
    expect(html).not.toContain('data-or-correct');
  });

  it('marks the correct pairing per left item after reveal', () => {
    const html = renderToStaticMarkup(
      <PairsChart
        interaction={{ ...match, correct: { l1: 'r1', l2: 'r2' } }}
        pairs={pairs}
        total={3}
        dontKnow={0}
        revealed
      />,
    );
    expect(html.match(/data-or-correct/g)).toHaveLength(2);
  });
});
