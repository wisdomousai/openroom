import { useEffect, useState } from 'react';

export interface SessionClockView {
  stepId: string;
  authoredSec: number;
  remainingSecAt: number;
  remainingSec: number;
  running: boolean;
  placement: 'slide' | 'corner';
}

/** Remaining seconds at `now`. Negative means overtime. */
export function clockRemainingSec(clock: SessionClockView, now = Date.now()): number {
  if (!clock.running) return clock.remainingSec;
  return clock.remainingSec - (now - clock.remainingSecAt) / 1000;
}

/**
 * Classroom digits. Holds at `0:00`, then overtime as `+1:20`.
 * Never a buzzer — the sign is the only extra mark.
 */
export function formatClock(remaining: number): string {
  if (remaining >= 0) {
    const total = Math.max(0, Math.ceil(remaining));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  const total = Math.floor(-remaining);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `+${m}:${s.toString().padStart(2, '0')}`;
}

/** Advisory question window. Zero never closes answering. */
export function formatQuestionLeft(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return formatClock(sec);
}

export function useClosesAt(closesAt: number | undefined): number | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    if (closesAt === undefined) {
      setSec(null);
      return;
    }
    const tick = () => setSec(Math.max(0, Math.ceil((closesAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [closesAt]);
  return sec;
}

/** Tick ~4×/s so the displayed second flips close to wall-clock boundaries. */
export function useSessionClock(clock: SessionClockView | undefined | null): {
  remaining: number | null;
  label: string | null;
  running: boolean;
  overtime: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [clock]);

  if (!clock) {
    return { remaining: null, label: null, running: false, overtime: false };
  }
  const remaining = clockRemainingSec(clock, now);
  return {
    remaining,
    label: formatClock(remaining),
    running: clock.running,
    overtime: remaining < 0,
  };
}
