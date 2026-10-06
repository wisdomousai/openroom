import { describe, expect, it } from 'vitest';
import {
  formatContentsMeta,
  homeworkLine,
  recapLine,
  slidesLine,
  summarizeOutline,
} from './contents-meta';

describe('formatContentsMeta', () => {
  it('states what is in the file, never a date', () => {
    expect(
      formatContentsMeta({
        slides: 6,
        askTheClass: 2,
        homework: true,
        recap: false,
        minutes: null,
      }),
    ).toBe('6 slides · 2 ask the class · homework');
  });

  it('singularises a single slide and a single ask', () => {
    expect(
      formatContentsMeta({
        slides: 1,
        askTheClass: 1,
        homework: false,
        recap: false,
        minutes: 3,
      }),
    ).toBe('1 slide · 1 ask the class · 3 min');
  });

  it('returns empty when there is nothing to say', () => {
    expect(
      formatContentsMeta({ slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null }),
    ).toBe('');
  });
});

describe('summarizeOutline', () => {
  it('counts interaction steps as ask-the-class', () => {
    const contents = summarizeOutline({
      steps: [{ kind: 'title' }, { kind: 'interaction' }, { kind: 'interaction' }],
      homework: { title: 'Six sentences' },
      meta: { durationMinutes: 16 },
    });
    expect(contents).toEqual({
      slides: 3,
      askTheClass: 2,
      homework: true,
      recap: false,
      minutes: 16,
    });
  });
});

describe('aside lines', () => {
  it('names homework and an unwritten recap', () => {
    expect(slidesLine({ slides: 6, askTheClass: 0, homework: false, recap: false, minutes: 16 })).toBe(
      '6 slides · 16 min',
    );
    expect(homeworkLine({ items: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(
      '6 items · sent when the session ends',
    );
    expect(recapLine(undefined)).toBe('Not written');
  });
});
