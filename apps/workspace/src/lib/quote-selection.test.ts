/**
 * A correction quoted by selection must pass the worker's share check,
 * `body.includes(original)`, whatever whitespace the selection caught.
 */
import { describe, expect, it } from 'vitest';

import { quoteAt } from './quote-selection';

describe('quoteAt', () => {
  const body = 'Je suis  allé à Berlin.\r\nLe train\tétait confortable.';

  it('drops whitespace around the selection and keeps the learner’s own inside it', () => {
    const start = body.indexOf(' allé') - 1;
    const end = body.indexOf('Le train') + 'Le train'.length + 1;
    const quote = quoteAt(body, start, end);
    expect(quote).toBe('allé à Berlin.\r\nLe train');
    expect(body.includes(quote!)).toBe(true);
  });

  it('gives nothing for a selection of only whitespace or an over-long one', () => {
    expect(quoteAt(body, 7, 9)).toBeNull();
    expect(quoteAt('a'.repeat(2001), 0, 2001)).toBeNull();
    expect(quoteAt('a'.repeat(2001), 0, 2000)).toBe('a'.repeat(2000));
  });
});
