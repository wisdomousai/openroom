import { describe, expect, it } from 'vitest';

import { normalizeTextAnswer, textAnswerMatches } from '../src/text-match.js';

describe('normalizeTextAnswer / textAnswerMatches', () => {
  it('trims and case-folds', () => {
    expect(normalizeTextAnswer('  Paris  ')).toBe('paris');
  });

  it('matches any accepted answer', () => {
    expect(textAnswerMatches('PARIS', ['Paris', 'City of Light'])).toBe(true);
    expect(textAnswerMatches(' city of light ', ['Paris', 'City of Light'])).toBe(true);
    expect(textAnswerMatches('Lyon', ['Paris'])).toBe(false);
  });

  it('rejects empty or missing keys', () => {
    expect(textAnswerMatches('', ['Paris'])).toBe(false);
    expect(textAnswerMatches('Paris', undefined)).toBe(false);
    expect(textAnswerMatches('Paris', [])).toBe(false);
  });

  it('requires accents by default', () => {
    expect(textAnswerMatches('ete', ['été'], { locale: 'fr' })).toBe(false);
    expect(textAnswerMatches('été', ['été'], { locale: 'fr' })).toBe(true);
  });

  it('ignores accents when asked', () => {
    expect(textAnswerMatches('ete', ['été'], { locale: 'fr', accents: 'ignore' })).toBe(true);
    expect(textAnswerMatches('Été', ['ete'], { locale: 'fr', accents: 'ignore' })).toBe(true);
  });

  it('strips punctuation when asked', () => {
    expect(textAnswerMatches("j'ai raté", ["J’ai raté"], { locale: 'fr', punctuation: 'strip' })).toBe(
      true,
    );
  });
});
