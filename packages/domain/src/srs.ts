/**
 * SM-2 for the learner practice pile.
 *
 * Two grades only: `again` (missed) and `good` (knew it). Teacher-facing
 * surfaces never see these numbers — only the domain math lives here.
 */

export type SrsGrade = 'again' | 'good';

export interface SrsState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: number;
}

export const SRS_DEFAULT_EASE = 2.5;
export const SRS_MIN_EASE = 1.3;

export function newSrsState(now: number): SrsState {
  return {
    ease: SRS_DEFAULT_EASE,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function gradeSrs(state: SrsState, grade: SrsGrade, now: number): SrsState {
  if (grade === 'again') {
    return {
      ease: Math.max(SRS_MIN_EASE, state.ease - 0.2),
      intervalDays: 0,
      reps: 0,
      lapses: state.lapses + 1,
      dueAt: now,
    };
  }
  const reps = state.reps + 1;
  const intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(state.intervalDays * state.ease));
  return {
    ease: state.ease,
    intervalDays,
    reps,
    lapses: state.lapses,
    dueAt: now + intervalDays * DAY_MS,
  };
}

export function srsIsDue(state: SrsState, now: number): boolean {
  return state.dueAt <= now;
}
