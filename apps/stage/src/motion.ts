/**
 * The single motion authority for the stage.
 *
 * Every animated surface — the GSAP timelines of the moment layer, the tweened
 * numbers and bars of the data layer, and the decision to mount the ambient
 * WebGL layer at all — consults the flag in here. `prefers-reduced-motion:
 * reduce` therefore collapses the whole stage to instant state changes in one
 * place instead of ten (PRD STAGE-10).
 *
 * The rule is deliberately blunt: with reduced motion every duration and every
 * stagger becomes 0, which turns a GSAP tween into a `set`. Nothing is skipped,
 * nothing is conditional, so the end state of an animation is always reached —
 * a tween that never runs would leave the DOM half-styled.
 */
import { gsap } from 'gsap';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Shared, mutable so a module without React context can still ask. */
export const MOTION = { reduced: false };

export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Point GSAP's defaults at the current preference. Called once at start-up and
 * again whenever the media query flips (a projector's accessibility settings
 * can change mid-session).
 */
export function applyMotionPreference(reduced: boolean): void {
  MOTION.reduced = reduced;
  gsap.defaults({
    duration: reduced ? 0 : SECONDS.base,
    ease: reduced ? 'none' : EASE.out,
    overwrite: 'auto',
  });
}

/** Seconds for a tween, forced to 0 under reduced motion. */
export function dur(seconds: number): number {
  return MOTION.reduced ? 0 : seconds;
}

/** Delay/stagger seconds, forced to 0 under reduced motion. */
export function stagger(seconds: number): number {
  return MOTION.reduced ? 0 : seconds;
}

/** The one easing vocabulary, so nothing on the stage moves in a foreign accent. */
export const EASE = {
  /** Decelerating — the default for anything arriving. */
  out: 'power3.out',
  /** Accelerating — for anything leaving. */
  in: 'power2.in',
  /** Both ends — for a value travelling between two known states. */
  inOut: 'power2.inOut',
  /** A touch of overshoot, reserved for the reveal's hero beat. */
  hero: 'back.out(1.6)',
  /**
   * The correct-answer burst. Hard throw, no rubber-band settle: this world's
   * celebration is geometry leaving the frame, not a sparkle bouncing in it.
   */
  celebrate: 'power3.out',
} as const;

/** The timing scale, in seconds. Everything cinematic is built from these. */
export const SECONDS = {
  /** Micro feedback: a chip flipping, a dot landing. */
  quick: 0.24,
  /** The workhorse: a bar growing, a number counting. */
  base: 0.55,
  /** A whole panel entering. */
  slow: 0.9,
} as const;

export type Ticket = { kill(): void };

/**
 * Create a timeline that is safe under reduced motion and returns a killer so
 * a React effect can clean up on unmount without leaking a running tween.
 */
export function timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
  return gsap.timeline({ defaults: { ease: EASE.out }, ...vars });
}

/**
 * Initialised at import time, not in a React effect.
 *
 * Entrance animations are scheduled from `useLayoutEffect` in child components,
 * which run *before* the root's `useEffect` — so a preference set from a hook
 * would arrive one frame too late and the very first question would animate on
 * a machine that asked for stillness. `useReducedMotion` keeps this in sync
 * afterwards.
 */
applyMotionPreference(prefersReducedMotion());
