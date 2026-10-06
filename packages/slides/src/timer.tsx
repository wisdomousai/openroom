import { useEffect, useState, type CSSProperties } from 'react';

import {
  clockPhase,
  clockProgress,
  clockRemaining,
  clockWholeSeconds,
  formatClock,
  type ClockPhase,
  type SlideClock,
} from './timer-clock';
import { formatStepSeconds } from './timer-text';

/** Timer visuals and the live classroom clock: LiveTimer, ClockPill. */

/** Known timer visuals; unknown / missing → countdown. */
export type TimerStyle =
  | 'countdown'
  | 'countup'
  | 'bar-empty'
  | 'bar-fill'
  | 'hourglass'
  | 'ring';

const TIMER_STYLE_SET = new Set<string>([
  'countdown',
  'countup',
  'bar-empty',
  'bar-fill',
  'hourglass',
  'ring',
]);

export function resolveTimerStyle(style: string | undefined): TimerStyle {
  if (style !== undefined && TIMER_STYLE_SET.has(style)) return style as TimerStyle;
  return 'countdown';
}

function useLiveClock(clock: SlideClock | undefined, authoredSec: number): {
  remaining: number;
  progress: number;
  phase: ClockPhase;
} {
  const total = Math.max(0, Math.floor(authoredSec));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (clock === undefined || !clock.running) return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [clock?.running, clock?.remainingSec, clock?.remainingSecAt]);
  const remaining = clock === undefined ? total : clockRemaining(clock, now);
  const progress = clockProgress(remaining, total);
  const phase = clockPhase(clock, remaining, total);
  return { remaining, progress, phase };
}

/**
 * Live timer for a timer step — digital countdown/count-up, bar, hourglass, or ring.
 *
 * Driven from session `clock` state. Landing on the slide with no clock shows
 * the authored duration, stopped. Never auto-starts.
 *
 * Mounted as its own component so hooks stay legal even when `StepLayout` is
 * sometimes *called* as a function (stage's `OutlineStepView`).
 */
export function LiveTimer({
  seconds,
  clock,
  style: rawStyle,
}: {
  seconds: number;
  clock?: SlideClock;
  style?: string;
}) {
  const style = resolveTimerStyle(rawStyle);
  const total = Math.max(0, Math.floor(seconds));
  const { remaining, progress, phase } = useLiveClock(clock, total);
  const whole = clockWholeSeconds(remaining);
  const elapsedSec = Math.max(0, total - remaining);
  const digits = style === 'countup' ? Math.max(0, Math.floor(elapsedSec)) : remaining;
  // Bar-empty drains; bar-fill / hourglass / ring fill as time passes.
  const fill =
    style === 'bar-empty' ? 1 - progress : style === 'countdown' || style === 'countup' ? 0 : progress;
  const running = phase === 'running' || phase === 'last-ten';
  const label =
    style === 'countup'
      ? `Timer ${formatClock(elapsedSec)} of ${formatStepSeconds(total)}`
      : phase === 'overrun'
        ? `Timer over by ${formatClock(remaining)}`
        : `Timer ${formatClock(remaining)} remaining`;

  return (
    <div
      className={`outline-step__timer outline-step__timer--${style}`}
      role="timer"
      aria-live={running ? 'polite' : undefined}
      aria-label={label}
      data-timer-style={style}
      data-timer-state={phase}
      style={
        {
          '--timer-progress': progress,
          '--timer-fill': fill,
          '--timer-remaining': total === 0 ? 0 : Math.max(0, remaining) / total,
        } as CSSProperties
      }
    >
      {style === 'ring' ? <TimerRing progress={progress} /> : null}
      {style === 'hourglass' ? <TimerHourglass progress={progress} /> : null}
      {style === 'bar-empty' || style === 'bar-fill' ? (
        <div
          className="outline-step__timer-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={style === 'bar-fill' ? Math.max(0, Math.floor(elapsedSec)) : Math.max(0, whole)}
        >
          <div className="outline-step__timer-bar-fill" />
        </div>
      ) : null}
      <span className="outline-step__timer-digits">{formatClock(digits)}</span>
    </div>
  );
}

/**
 * Corner furniture for a clock that is not the slide. Always top-right.
 * Six states: idle, running, last-ten, paused, done, overrun.
 */
export function ClockPill({
  clock,
  authoredSec,
}: {
  clock?: SlideClock;
  authoredSec?: number;
}) {
  const total = Math.max(0, Math.floor(authoredSec ?? clock?.authoredSec ?? 0));
  const { remaining, phase } = useLiveClock(clock, total);
  const mark =
    phase === 'paused' ? 'pause' : phase === 'last-ten' || phase === 'done' || phase === 'overrun' ? 'none' : 'dot';
  return (
    <span
      className="clock-pill"
      data-clock-state={phase}
      role="timer"
      aria-label={
        phase === 'overrun'
          ? `Timer over by ${formatClock(remaining)}`
          : `Timer ${formatClock(remaining)} remaining`
      }
    >
      {mark === 'pause' ? (
        <span className="clock-pill__mark" aria-hidden="true">
          ⏸
        </span>
      ) : mark === 'dot' ? (
        <span className="clock-pill__dot" aria-hidden="true" />
      ) : null}
      {formatClock(remaining)}
    </span>
  );
}

/** Circular progress: stroke drains as time runs out (full at start). */
function TimerRing({ progress }: { progress: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  // Remaining fraction of the circle (starts full, empties).
  const remaining = Math.max(0, 1 - progress);
  return (
    <svg
      className="outline-step__timer-ring"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <circle className="outline-step__timer-ring-track" cx="50" cy="50" r={r} />
      <circle
        className="outline-step__timer-ring-value"
        cx="50"
        cy="50"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - remaining)}
      />
    </svg>
  );
}

/** Hourglass: top chamber drains into the bottom as progress rises. */
function TimerHourglass({ progress }: { progress: number }) {
  const top = Math.max(0, 1 - progress);
  const bottom = Math.min(1, progress);
  return (
    <div className="outline-step__timer-hourglass" aria-hidden="true">
      <div className="outline-step__timer-hourglass-frame">
        <div className="outline-step__timer-hourglass-chamber outline-step__timer-hourglass-chamber--top">
          <div
            className="outline-step__timer-hourglass-sand"
            style={{ transform: `scaleY(${String(top)})` }}
          />
        </div>
        <div className="outline-step__timer-hourglass-neck" />
        <div className="outline-step__timer-hourglass-chamber outline-step__timer-hourglass-chamber--bottom">
          <div
            className="outline-step__timer-hourglass-sand"
            style={{ transform: `scaleY(${String(bottom)})` }}
          />
        </div>
      </div>
    </div>
  );
}
