import { useEffect, useState } from 'react';

/** Whole seconds remaining until `closesAt` (ms), or null when unarmed. */
export function remainingSec(closesAt: number | undefined | null, now = Date.now()): number | null {
  if (closesAt === undefined || closesAt === null) return null;
  return Math.max(0, Math.ceil((closesAt - now) / 1000));
}

/** Calm mm:ss (or Ns under a minute) — no urgency styling baked in. */
export function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** True when the classroom clock is furniture on this slide, not the slide. */
export function cornerClockVisible(
  clock: { stepId: string; placement: 'slide' | 'corner' } | undefined,
  current?: { kind: string; id: string } | null,
): boolean {
  if (clock === undefined) return false;
  const onOwnSlide = current?.kind === 'timer' && current.id === clock.stepId;
  return !(onOwnSlide && clock.placement !== 'corner');
}

/** Tick ~4×/s so the displayed second flips close to wall-clock boundaries. */
export function useCountdown(closesAt: number | undefined | null): number | null {
  const [sec, setSec] = useState(() => remainingSec(closesAt));
  useEffect(() => {
    if (closesAt === undefined || closesAt === null) {
      setSec(null);
      return;
    }
    const tick = () => setSec(remainingSec(closesAt));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [closesAt]);
  return sec;
}
