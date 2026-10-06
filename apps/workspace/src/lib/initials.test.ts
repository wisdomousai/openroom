import { describe, expect, it } from 'vitest';
import { badgeChart, givenName, initials, possessive } from './initials';

describe('initials', () => {
  it('takes first and last letters of a two-word name', () => {
    expect(initials('Camille D.')).toBe('CD');
    expect(initials('Marc H.')).toBe('MH');
  });

  it('uses two letters of a single word', () => {
    expect(initials('Camille')).toBe('CA');
  });
});

describe('givenName / possessive', () => {
  it('takes the first word', () => {
    expect(givenName('Camille D.')).toBe('Camille');
  });

  it('adds a possessive without doubling s', () => {
    expect(possessive('Camille')).toBe("Camille's");
    expect(possessive('James')).toBe("James'");
  });
});

describe('badgeChart', () => {
  it('is stable for the same id', () => {
    expect(badgeChart('ctx-1')).toBe(badgeChart('ctx-1'));
  });
});
