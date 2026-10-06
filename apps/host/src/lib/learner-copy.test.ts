import { describe, expect, it } from 'vitest';
import { resolveLearnerLocale } from './learner-copy';

describe('learner interface language', () => {
  it('prefers a saved choice, then the first supported browser language, then English', () => {
    expect(resolveLearnerLocale('en', ['fr-CH', 'de'])).toBe('en');
    expect(resolveLearnerLocale(null, ['it-CH', 'de-CH', 'fr'])).toBe('de');
    expect(resolveLearnerLocale('invalid', ['FR-ca', 'en'])).toBe('fr');
    expect(resolveLearnerLocale(null, ['it', 'ja'])).toBe('en');
    expect(resolveLearnerLocale(null, [])).toBe('en');
  });
});
