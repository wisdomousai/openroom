import { describe, expect, it } from 'vitest';
import { lookupError } from './learner-lookup';

describe('lookupError', () => {
  it('does not call a refused word a missing dictionary', () => {
    expect(lookupError(422, 'invalid-word')).not.toBe(lookupError(422, 'languages-not-configured'));
    expect(lookupError(422, 'languages-not-configured')).toBe('No dictionary for this session.');
  });

  it('names the rate limit and a server failure apart', () => {
    expect(lookupError(429, 'lookup-rate-limited')).toMatch(/limit/);
    expect(lookupError(502, undefined)).toBe('Lookup failed. Try again.');
  });
});
