import { describe, expect, it } from 'vitest';

import {
  clearStyle,
  concatText,
  formatAtRange,
  hasFormat,
  normalizeSpans,
  plainToSpans,
  replaceRange,
  retargetSpans,
  styleRange,
} from './spans.js';

const plain = plainToSpans('Le passé composé');

describe('spans algebra', () => {
  it('concatenates to the plain text', () => {
    expect(concatText(plain)).toBe('Le passé composé');
  });

  it('styles a middle range and splits boundary spans', () => {
    const styled = styleRange(plain, 3, 8, { bold: true });
    expect(concatText(styled)).toBe('Le passé composé');
    expect(styled).toEqual([
      { text: 'Le ' },
      { text: 'passé', bold: true },
      { text: ' composé' },
    ]);
  });

  it('merges adjacent spans with identical formatting', () => {
    const merged = normalizeSpans([
      { text: 'ab', bold: true },
      { text: 'cd', bold: true },
      { text: 'e' },
    ]);
    expect(merged).toEqual([{ text: 'abcd', bold: true }, { text: 'e' }]);
  });

  it('drops empty spans during normalization', () => {
    const cleaned = normalizeSpans([{ text: '' }, { text: 'x' }, { text: '' }]);
    expect(cleaned).toEqual([{ text: 'x' }]);
  });

  it('applies a patch across multiple existing spans', () => {
    const base = styleRange(plain, 0, 9, { italic: true });
    const both = styleRange(base, 3, 16, { color: '#0F6CBD' });
    expect(concatText(both)).toBe('Le passé composé');
    expect(both[0]).toEqual({ text: 'Le ', italic: true });
    expect(both[1]).toEqual({ text: 'passé ', italic: true, color: '#0F6CBD' });
    expect(both[2]).toEqual({ text: 'composé', color: '#0F6CBD' });
  });

  it('clears only the requested properties in the range', () => {
    const styled = [
      { text: 'a', bold: true, color: '#FF0000' as const },
      { text: 'b', bold: true },
    ];
    // Removing `color` makes the two neighbors identical, so they merge.
    const cleared = clearStyle(styled, 0, 2, ['color']);
    expect(cleared).toEqual([{ text: 'ab', bold: true }]);
  });

  it('reports toggle state for a fully covered range', () => {
    const styled = styleRange(plain, 3, 8, { bold: true });
    expect(hasFormat(styled, 3, 8, 'bold')).toBe(true);
    expect(hasFormat(styled, 3, 9, 'bold')).toBe(false);
    expect(hasFormat(styled, 0, 3, 'bold')).toBe(false);
  });

  it('reads the common format of a mixed selection as undefined', () => {
    const styled = styleRange(plain, 0, 4, { bold: true, size: 200 });
    expect(formatAtRange(styled, 0, 8)).toBeUndefined();
    expect(formatAtRange(styled, 0, 4)).toEqual({ bold: true, size: 200 });
  });

  it('reports the caret-side format for an empty selection', () => {
    const styled = styleRange(plain, 3, 8, { bold: true });
    expect(formatAtRange(styled, 5, 5)?.bold).toBe(true);
    expect(formatAtRange(styled, 10, 10)?.bold).toBeUndefined();
  });

  it('keeps offsets one-to-one with text after every operation', () => {
    let spans = plain;
    spans = styleRange(spans, 0, 5, { size: 300 });
    spans = styleRange(spans, 5, 12, { family: 'mono' });
    spans = clearStyle(spans, 2, 7, ['size']);
    spans = styleRange(spans, 8, 14, { underline: true });
    expect(concatText(spans)).toBe('Le passé composé');
    expect(spans.map((span) => span.text.length).reduce((a, b) => a + b, 0)).toBe(16);
  });

  it('replaces a range and inherits the format of the overlapped span', () => {
    const styled = styleRange(plain, 3, 8, { bold: true });
    const replaced = replaceRange(styled, 3, 8, 'simple');
    expect(concatText(replaced)).toBe('Le simple composé');
    expect(replaced.find((span) => span.text.includes('simple'))?.bold).toBe(true);
  });

  it('retargets spans after a text edit, preserving untouched styling', () => {
    const styled = styleRange(plain, 3, 8, { color: '#CA5010' });
    const retargeted = retargetSpans(concatText(styled), styled, 'Le passé plus que parfait composé');
    expect(retargeted.find((span) => span.color === '#CA5010')?.text).toBe('passé');
    expect(concatText(retargeted)).toBe('Le passé plus que parfait composé');
  });
});
