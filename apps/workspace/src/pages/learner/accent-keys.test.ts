import { describe, expect, it } from 'vitest';
import { practiceLocale } from '@openroom/schema';
import { accentKeysFor, insertCharacter } from './accent-keys';

describe('accent keys for typed practice answers', () => {
  it('follows the exercise language, and shows nothing for other or unknown languages', () => {
    expect(accentKeysFor(practiceLocale({ id: 'q', type: 'text', prompt: 'Été ?', match: { locale: 'FR-ca' } }))).toContain('œ');
    expect(accentKeysFor('de-CH')).toEqual(['ä', 'ö', 'ü', 'ß']);
    expect(accentKeysFor('es')).toContain('¿');
    expect(accentKeysFor('en-GB')).toEqual([]);
    expect(accentKeysFor(practiceLocale({ id: 'q', type: 'text', prompt: 'x', match: { locale: 'not a locale' } }))).toEqual([]);
    expect(accentKeysFor(undefined)).toEqual([]);
  });

  it('inserts at the cursor, replaces a selection and respects the length limit', () => {
    expect(insertCharacter('ete', 0, 1, 'é', 200)).toEqual({ value: 'éte', caret: 1 });
    expect(insertCharacter('caf', 3, 3, 'é', 200)).toEqual({ value: 'café', caret: 4 });
    expect(insertCharacter('ca', null, null, 'ç', 200)).toEqual({ value: 'caç', caret: 3 });
    expect(insertCharacter('abc', 3, 3, 'é', 3)).toBeNull();
  });
});
