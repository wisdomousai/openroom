import { describe, expect, it } from 'vitest';

import { SRS_MIN_EASE, gradeSrs, newSrsState, srsIsDue } from '../src/srs.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('gradeSrs', () => {
  it('starts due immediately', () => {
    const fresh = newSrsState(NOW);
    expect(fresh.intervalDays).toBe(0);
    expect(srsIsDue(fresh, NOW)).toBe(true);
  });

  it('advances 1 then 6 then ease-multiplied days on good', () => {
    const first = gradeSrs(newSrsState(NOW), 'good', NOW);
    expect(first.reps).toBe(1);
    expect(first.intervalDays).toBe(1);
    expect(first.dueAt).toBe(NOW + DAY);

    const second = gradeSrs(first, 'good', NOW + DAY);
    expect(second.reps).toBe(2);
    expect(second.intervalDays).toBe(6);
    expect(second.dueAt).toBe(NOW + DAY + 6 * DAY);

    const third = gradeSrs(second, 'good', NOW + 8 * DAY);
    expect(third.reps).toBe(3);
    expect(third.intervalDays).toBe(Math.round(6 * second.ease));
    expect(srsIsDue(third, NOW + 8 * DAY)).toBe(false);
  });

  it('resets the interval and increments lapses on again', () => {
    const known = gradeSrs(newSrsState(NOW), 'good', NOW);
    const missed = gradeSrs(known, 'again', NOW + DAY);
    expect(missed.reps).toBe(0);
    expect(missed.intervalDays).toBe(0);
    expect(missed.lapses).toBe(1);
    expect(missed.ease).toBeLessThan(known.ease);
    expect(missed.ease).toBeGreaterThanOrEqual(SRS_MIN_EASE);
    expect(srsIsDue(missed, NOW + DAY)).toBe(true);
  });
});
