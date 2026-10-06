import { useEffect, useRef, useState } from 'react';
import { REDUCED_MOTION_QUERY, applyMotionPreference, prefersReducedMotion } from './motion';

/**
 * Tracks `prefers-reduced-motion` live and keeps the shared MOTION flag (and
 * therefore GSAP's defaults) in sync. Mounted exactly once, at the app root.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    applyMotionPreference(reduced);
  }, [reduced]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * False while the tab is hidden. The ambient layer parks its render loop on
 * this: a projector stage often sits behind slides for minutes at a time and
 * has no business burning a GPU while nobody can see it.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * A 0..1 measure of how busy the session is right now, decayed over time.
 *
 * The ambient layer breathes with it — answers arriving make the field a touch
 * brighter and faster. It is the only channel between data and atmosphere, and
 * it is deliberately lossy: you cannot read a number off it, which is exactly
 * why it is allowed to be 3D.
 */
export function useActivity(answeredCount: number): number {
  const [activity, setActivity] = useState(0);
  const previous = useRef(answeredCount);
  const value = useRef(0);

  useEffect(() => {
    const delta = answeredCount - previous.current;
    previous.current = answeredCount;
    if (delta > 0) {
      value.current = Math.min(1, value.current + Math.min(0.5, delta * 0.12));
      setActivity(value.current);
    }
  }, [answeredCount]);

  useEffect(() => {
    const id = setInterval(() => {
      if (value.current <= 0.001) return;
      value.current = Math.max(0, value.current * 0.82 - 0.01);
      setActivity(value.current);
    }, 500);
    return () => clearInterval(id);
  }, []);

  return activity;
}

/** True for one animation cycle after `value` increases — drives pulses. */
export function useBump(value: number, ms = 420): boolean {
  const [bumping, setBumping] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value > prev.current) {
      setBumping(true);
      const id = setTimeout(() => setBumping(false), ms);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
    return undefined;
  }, [value, ms]);
  return bumping;
}
