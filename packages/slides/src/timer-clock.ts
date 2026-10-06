/**
 * Classroom clock — remaining seconds, phase, and digits.
 *
 * Session state carries `remainingSec` sampled at `remainingSecAt`. While
 * `running`, clients tick locally. The clock never starts itself: a missing
 * clock is the authored duration, stopped. Zero is not a buzzer — it holds,
 * then counts up in the overrun phase.
 */

export interface SlideClock {
  authoredSec: number;
  remainingSecAt: number;
  remainingSec: number;
  running: boolean;
  placement?: 'slide' | 'corner';
}

export type ClockPhase = 'idle' | 'running' | 'last-ten' | 'paused' | 'done' | 'overrun';

/** Signed remaining seconds at `now`. Negative means the clock has overrun. */
export function clockRemaining(clock: SlideClock, now = Date.now()): number {
  if (!clock.running) return clock.remainingSec;
  return clock.remainingSec - (now - clock.remainingSecAt) / 1000;
}

/**
 * Whole-second remaining used for digits. `ceil` so 4.2s still reads 5s, and
 * the first second at or below zero holds `0` before overrun goes negative.
 */
export function clockWholeSeconds(remaining: number): number {
  if (remaining > 0) return Math.ceil(remaining);
  if (remaining > -1) return 0;
  return Math.ceil(remaining);
}

export function clockPhase(
  clock: SlideClock | undefined,
  remaining: number,
  authoredSec: number,
): ClockPhase {
  const whole = clockWholeSeconds(remaining);
  if (whole < 0) return 'overrun';
  if (whole === 0 && clock !== undefined) return 'done';
  if (clock === undefined || (!clock.running && remaining >= authoredSec - 0.001)) {
    return 'idle';
  }
  if (!clock.running) return 'paused';
  if (remaining <= 10) return 'last-ten';
  return 'running';
}

/**
 * Digits for the classroom clock.
 *
 * Under a minute the existing countdown grammar stays (`42s`). Done holds
 * `0:00`. Overrun prefixes `+`.
 */
export function formatClock(remaining: number): string {
  const whole = clockWholeSeconds(remaining);
  if (whole < 0) return `+${formatUnsigned(-whole)}`;
  if (whole === 0) return '0:00';
  return formatUnsigned(whole);
}

function formatUnsigned(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${String(s)}s`;
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}

/** 0–1 fraction of the authored duration that has elapsed. Clamped. */
export function clockProgress(remaining: number, authoredSec: number): number {
  if (authoredSec <= 0) return 1;
  return Math.min(1, Math.max(0, (authoredSec - remaining) / authoredSec));
}
