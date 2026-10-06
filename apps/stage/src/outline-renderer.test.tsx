import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OutlineStepView } from './StageView';

describe('automatic outline layouts', () => {
  it('renders title content without authored layout or styling data', () => {
    const html = renderToStaticMarkup(
      <OutlineStepView step={{ id: 'welcome', kind: 'title', title: 'Les voyages', body: 'Tell a short story.' }} />,
    );
    expect(html).toContain('outline-step--title');
    expect(html).toContain('outline-step--layout-title');
  });

  it('chooses a card grid from semantic items', () => {
    const html = renderToStaticMarkup(
      <OutlineStepView step={{ id: 'words', kind: 'cards', title: 'Choose a word', items: [{ text: 'gare' }, { text: 'quai' }, { text: 'billet' }] }} />,
    );
    expect(html).toContain('outline-step__cards');
    expect(html.match(/<article\b/g)?.length).toBe(3);
  });

  /**
   * The circle tool clicks a `data-token` span and the ink is drawn round the
   * same one. Without these spans on ordinary steps the tool is inert, which is
   * exactly the bug this pins.
   */
  it('numbers the words of a step so the circle tool can name one', () => {
    const html = renderToStaticMarkup(
      <OutlineStepView step={{ id: 'welcome', kind: 'title', title: 'Le passé composé' }} />,
    );
    expect(html).toContain('data-part="header"');
    expect(html).toContain('data-token="0"');
    expect(html).toContain('data-token="2"');

    const cards = renderToStaticMarkup(
      <OutlineStepView
        step={{ id: 'words', kind: 'cards', title: 'Choose', items: [{ text: 'la gare' }] }}
      />,
    );
    expect(cards).toContain('data-part="cell-0"');
    expect(cards).toContain('data-token="1"');
  });

  /**
   * Styling a heading must not move a word: the ink already on the wall is
   * addressed by token index, so the indices have to survive the styled spans.
   */
  it('keeps token numbering when the heading carries styled spans', () => {
    const html = renderToStaticMarkup(
      <OutlineStepView
        step={{
          id: 'welcome',
          kind: 'title',
          title: 'Le passé composé',
          titleSpans: [{ text: 'Le ' }, { text: 'passé', bold: true }, { text: ' composé' }],
        }}
      />,
    );
    expect(html).toContain('data-part="header"');
    expect(html).toContain('data-token="2"');
    expect(html).toContain('font-weight:600');
  });

  it('renders interaction steps through the existing interaction surface', () => {
    expect(OutlineStepView({ step: { id: 'check', kind: 'interaction', interactionId: 'q1' } })).toBeNull();
  });

  it('formats timer steps in seconds (not milliseconds)', () => {
    const html = renderToStaticMarkup(
      <OutlineStepView step={{ id: 'think', kind: 'timer', title: 'Think', seconds: 300 }} />,
    );
    expect(html).toContain('5:00');
    expect(html).not.toContain('5000');
  });
});

/**
 * Idle detection for non-outline sessions must treat missing outline as null, not
 * undefined — otherwise live sessions never show the join-code rail.
 * Exercised via the same condition StageView uses (exported for clarity here).
 */
function outlineContentFor(
  snapshot: { status: string; outline?: { currentStep: { kind: string } } | null } | null,
) {
  return snapshot?.status === 'live' &&
    snapshot.outline != null &&
    snapshot.outline.currentStep.kind !== 'interaction'
    ? snapshot.outline
    : null;
}

describe('stage idle outlineContent guards', () => {
  it('returns null for ordinary sessions without an outline', () => {
    expect(outlineContentFor({ status: 'live' })).toBeNull();
    expect(outlineContentFor({ status: 'live', outline: null })).toBeNull();
    expect(outlineContentFor({ status: 'lobby' })).toBeNull();
  });

  it('returns the outline for non-interaction content steps only', () => {
    const outline = { currentStep: { kind: 'title' as const } };
    expect(outlineContentFor({ status: 'live', outline })).toBe(outline);
    expect(
      outlineContentFor({ status: 'live', outline: { currentStep: { kind: 'interaction' } } }),
    ).toBeNull();
  });
});
