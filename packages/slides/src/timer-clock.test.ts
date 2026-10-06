import { describe, expect, it } from 'vitest';

import {
  clockPhase,
  clockProgress,
  clockRemaining,
  clockWholeSeconds,
  formatClock,
  type SlideClock,
} from './timer-clock';

const now = 1_700_000_000_000;

function clock(over: Partial<SlideClock> = {}): SlideClock {
  return {
    authoredSec: 360,
    remainingSecAt: now,
    remainingSec: 360,
    running: false,
    ...over,
  };
}

describe('clockRemaining', () => {
  it('returns the sampled remaining while stopped', () => {
    expect(clockRemaining(clock({ remainingSec: 105, running: false }), now + 8_000)).toBe(105);
  });

  it('subtracts elapsed wall time while running', () => {
    expect(clockRemaining(clock({ remainingSec: 120, running: true }), now + 15_000)).toBe(105);
  });

  it('goes negative after zero — overrun is just more remaining', () => {
    expect(clockRemaining(clock({ remainingSec: 5, running: true }), now + 25_000)).toBe(-20);
  });
});

describe('clockWholeSeconds', () => {
  it('ceils a still-positive remainder so 4.2s still reads 5s', () => {
    expect(clockWholeSeconds(4.2)).toBe(5);
    expect(clockWholeSeconds(0.1)).toBe(1);
  });

  it('holds 0 for the first second at or below zero', () => {
    expect(clockWholeSeconds(0)).toBe(0);
    expect(clockWholeSeconds(-0.2)).toBe(0);
    expect(clockWholeSeconds(-0.99)).toBe(0);
  });

  it('counts up in whole negative seconds after that', () => {
    expect(clockWholeSeconds(-1)).toBe(-1);
    expect(clockWholeSeconds(-80)).toBe(-80);
  });
});

describe('clockPhase', () => {
  it('is idle with no clock, or a stopped clock still at the authored length', () => {
    expect(clockPhase(undefined, 360, 360)).toBe('idle');
    expect(clockPhase(clock(), 360, 360)).toBe('idle');
  });

  it('is paused when stopped part-way', () => {
    expect(clockPhase(clock({ remainingSec: 155 }), 155, 360)).toBe('paused');
  });

  it('is running above ten seconds and last-ten at or below', () => {
    const running = clock({ running: true, remainingSec: 40 });
    expect(clockPhase(running, 40, 360)).toBe('running');
    expect(clockPhase(running, 10, 360)).toBe('last-ten');
    expect(clockPhase(running, 0.4, 360)).toBe('last-ten');
  });

  it('holds done at zero, then overrun once the extra second starts', () => {
    const running = clock({ running: true, remainingSec: 0 });
    expect(clockPhase(running, 0, 360)).toBe('done');
    expect(clockPhase(running, -0.5, 360)).toBe('done');
    expect(clockPhase(running, -1, 360)).toBe('overrun');
  });
});

describe('formatClock', () => {
  it('keeps bare seconds under a minute', () => {
    expect(formatClock(42)).toBe('42s');
    expect(formatClock(8)).toBe('8s');
  });

  it('uses mm:ss at a minute and above', () => {
    expect(formatClock(80)).toBe('1:20');
    expect(formatClock(360)).toBe('6:00');
  });

  it('holds 0:00 at zero', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-0.4)).toBe('0:00');
  });

  it('prefixes overrun with + and keeps the same grammar', () => {
    expect(formatClock(-8)).toBe('+8s');
    expect(formatClock(-80)).toBe('+1:20');
  });
});

describe('clockProgress', () => {
  it('is 0 at the authored length and 1 at or past zero', () => {
    expect(clockProgress(360, 360)).toBe(0);
    expect(clockProgress(0, 360)).toBe(1);
    expect(clockProgress(-20, 360)).toBe(1);
  });

  it('is the elapsed fraction in between', () => {
    expect(clockProgress(180, 360)).toBeCloseTo(0.5);
  });
});
