import { describe, expect, it } from 'vitest';
import { clockRemainingSec, formatClock, type SessionClockView } from './liveClock';

const clock = (partial: Partial<SessionClockView> = {}): SessionClockView => ({
  stepId: 't',
  authoredSec: 120,
  remainingSecAt: 1_000,
  remainingSec: 120,
  running: false,
  placement: 'slide',
  ...partial,
});

describe('formatClock', () => {
  it('renders mm:ss for a remaining duration', () => {
    expect(formatClock(252)).toBe('4:12');
    expect(formatClock(12)).toBe('0:12');
    expect(formatClock(0)).toBe('0:00');
  });

  it('holds at 0:00 then counts up with a plus', () => {
    expect(formatClock(-0.4)).toBe('+0:00');
    expect(formatClock(-80)).toBe('+1:20');
  });
});

describe('clockRemainingSec', () => {
  it('returns the sampled remaining while paused', () => {
    expect(clockRemainingSec(clock({ remainingSec: 105, running: false }), 20_000)).toBe(105);
  });

  it('subtracts elapsed wall time while running', () => {
    expect(
      clockRemainingSec(
        clock({ remainingSec: 120, remainingSecAt: 10_000, running: true }),
        25_000,
      ),
    ).toBe(105);
  });
});
