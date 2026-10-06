import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpanText, TokenSpanWords, sliceSpans } from './span-text';
import type { SlideSpanStyle } from './slide-types';

/**
 * Tokens outside, spans inside.
 *
 * The live surfaces resolve a circled word with `closest('[data-token]')`, so
 * the numbering has to survive styling — including a span boundary that falls
 * in the middle of a word. And an unstyled slot has to render exactly the
 * markup the projector drew before spans existed, or every existing ink mark
 * would land somewhere new.
 */

const TEXT = 'Le passé composé';

function html(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

describe('sliceSpans', () => {
  it('cuts the span list at character offsets', () => {
    const spans: SlideSpanStyle[] = [{ text: 'Le ' }, { text: 'passé', bold: true }, { text: ' composé' }];
    expect(sliceSpans(spans, 0, 5)).toEqual([{ text: 'Le ' }, { text: 'pa', bold: true }]);
    expect(sliceSpans(spans, 5, 5)).toEqual([]);
  });
});

describe('TokenSpanWords', () => {
  it('draws the same markup as before when nothing is styled', () => {
    expect(html(<TokenSpanWords text={TEXT} />)).toBe(
      '<span data-token="0">Le</span> <span data-token="1">passé</span> <span data-token="2">composé</span>',
    );
  });

  it('keeps token indices identical once the text is styled', () => {
    const styled = html(
      <TokenSpanWords text={TEXT} spans={[{ text: 'Le ' }, { text: 'passé composé', bold: true }]} />,
    );
    const indices = [...styled.matchAll(/data-token="(\d)"/g)].map((match) => match[1]);
    expect(indices).toEqual(['0', '1', '2']);
  });

  it('nests a mid-word span boundary inside one token span', () => {
    const styled = html(
      <TokenSpanWords text={TEXT} spans={[{ text: 'Le pa', bold: true }, { text: 'ssé composé' }]} />,
    );
    expect(styled).toContain('<span data-token="1"><span style="font-weight:600">pa</span><span>ssé</span></span>');
    expect([...styled.matchAll(/data-token=/g)]).toHaveLength(3);
  });

  it('carries styling across the space between two styled words', () => {
    const styled = html(
      <TokenSpanWords text="Le passé" spans={[{ text: 'Le passé', underline: true }]} />,
    );
    // The whitespace is its own span, styled, and carries no token index.
    expect(styled).toContain('<span><span style="text-decoration:underline"> </span></span>');
  });
});

describe('SpanText', () => {
  it('draws one span per span, with no token numbering', () => {
    expect(html(<SpanText spans={[{ text: 'Le ' }, { text: 'passé', italic: true }]} />)).toBe(
      '<span>Le </span><span style="font-style:italic">passé</span>',
    );
  });
});
