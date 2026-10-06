import {
  resolveRevealOrder,
  displaysFor,
  normalizeSession,
  parseDictionaryEntry,
  validateOutline,
  type Interaction,
  type OutlineStep,
  type OutlineTimerStep,
  type NormalizedInteraction,
} from '@openroom/schema';

import { computeAggregate, emptyAggregate } from '../aggregate.js';
import { applyBlocklist } from '../blocklist.js';
import { isPollOnlyOutline, sessionOf } from '../create-session.js';
import { ensureQna, qnaMaxLength, QNA_QUESTION_ID_MAX_LENGTH } from '../qna.js';
import { INK_COLORS, isKnownTheme, SESSION_THEME_IDS, TOKEN_MARK_KINDS } from '../types.js';
import type {
  AnswerInput,
  ApplyResult,
  Ballot,
  Command,
  CommandEnvelope,
  DomainError,
  DomainErrorCode,
  InkColor,
  InteractionRuntime,
  QnaQuestion,
  QnaStagePlacement,
  SessionClock,
  SessionMark,
  SessionState,
  TimerPlacement,
} from '../types.js';

/**
 * Shared plumbing for the command families: result builders, runtime
 * bookkeeping, clock helpers and outline navigation. Internal to `apply/`;
 * the public surface stays `applyCommand` via the package index.
 */

/**
 * Ink is ephemeral (cleared on navigation and on end) but it still rides every
 * snapshot, so the session caps it: a stroke keeps its first 200 points and a step
 * holds 50 marks. Both are far past what a hand draws between two slides.
 */
export const MAX_MARK_POINTS = 200;
export const MAX_ROOM_MARKS = 50;

/**
 * Same reasoning, applied to the projected forms table: it rides every
 * snapshot to every phone, so the session caps it. A full entry measures ~5 KB;
 * 8 KB leaves headroom without letting a table become a payload.
 */
export const MAX_DICTIONARY_BYTES = 8192;

export function fail(code: DomainErrorCode, message: string): { ok: false; error: DomainError } {
  return { ok: false, error: { code, message } };
}

/** Success that changed nothing: no revision bump, no notify effect (INT-06). */
export function noop(state: SessionState): ApplyResult {
  return { ok: true, state, revision: state.revision, effects: [] };
}

/** Success that changed something: bump revision and emit a notify effect. */
export function commit(next: SessionState): ApplyResult {
  const revision = next.revision + 1;
  const state: SessionState = { ...next, revision };
  return { ok: true, state, revision, effects: [{ type: 'notify' }] };
}

export function sessionInteraction(state: SessionState, id: string): NormalizedInteraction | undefined {
  return sessionOf(state).interactions.find((interaction) => interaction.id === id);
}

export function withRuntime(
  state: SessionState,
  id: string,
  runtime: InteractionRuntime,
): SessionState {
  return { ...state, interactions: { ...state.interactions, [id]: runtime } };
}

export function ensureParticipant(state: SessionState, participantId: string, now: number): SessionState {
  if (state.participants[participantId] !== undefined) return state;
  return {
    ...state,
    participants: { ...state.participants, [participantId]: { joinedAt: now } },
  };
}

/**
 * Advisory `closesAt` from the session `timerSec`, or undefined when no timer.
 * Zero never closes answering; the teacher closes. The session still arms the
 * window so clients can drain a countdown.
 */
export function armClosesAt(
  interaction: { timerSec?: number } | undefined,
  now: number,
): number | undefined {
  const sec = interaction?.timerSec;
  if (typeof sec !== 'number' || sec < 1) return undefined;
  return now + sec * 1000;
}

export function remainingNow(clock: SessionClock, now: number): number {
  if (!clock.running) return clock.remainingSec;
  return clock.remainingSec - (now - clock.remainingSecAt) / 1000;
}

export function timerStepById(state: SessionState, stepId: string): OutlineTimerStep | undefined {
  const step = state.outline?.content.steps.find((candidate) => candidate.id === stepId);
  return step?.kind === 'timer' ? step : undefined;
}

export function currentTimerStep(state: SessionState): OutlineTimerStep | undefined {
  const outline = state.outline;
  if (outline === undefined) return undefined;
  const step = outline.content.steps[outline.currentStepIndex];
  return step?.kind === 'timer' ? step : undefined;
}

export function clockFromStep(step: OutlineTimerStep, now: number, running: boolean): SessionClock {
  const placement: TimerPlacement = step.placement === 'corner' ? 'corner' : 'slide';
  return {
    stepId: step.id,
    authoredSec: step.seconds,
    remainingSecAt: now,
    remainingSec: step.seconds,
    running,
    placement,
  };
}

/** Clock is independent of the current slide. Persist/corner: keep it, flip to corner. */
export function clockAfterNavigate(state: SessionState, now: number): SessionState {
  const clock = state.clock;
  if (clock === undefined) return state;
  const step = timerStepById(state, clock.stepId);
  const persist = step?.persist !== false;
  const current = state.outline?.content.steps[state.outline.currentStepIndex];
  const onOwnSlide = current?.kind === 'timer' && current.id === clock.stepId;
  if (onOwnSlide) return state;
  if (!persist) {
    const { clock: _dropped, ...rest } = state;
    return rest;
  }
  const remaining = remainingNow(clock, now);
  return {
    ...state,
    clock: {
      ...clock,
      remainingSec: remaining,
      remainingSecAt: now,
      placement: 'corner',
    },
  };
}

/** Close an open runtime and drop any armed countdown. */
export function closeRuntime(runtime: InteractionRuntime, now: number): InteractionRuntime {
  const { closesAt: _cleared, ...rest } = runtime;
  return { ...rest, status: 'closed', closedAt: now };
}

/**
 * Close whatever is currently open. `activeInteractionId` is deliberately left
 * alone: an interaction stays "the one on screen" through close and reveal, and
 * only stops being active when another interaction opens.
 */
export function closeActive(state: SessionState, now: number): SessionState {
  const activeId = state.activeInteractionId;
  if (activeId === null) return state;
  const runtime = state.interactions[activeId];
  if (runtime === undefined || runtime.status !== 'open') return state;
  return withRuntime(state, activeId, closeRuntime(runtime, now));
}

export function navigateOutline(
  state: SessionState,
  targetIndex: number,
  now: number,
): { ok: true; state: SessionState } | { ok: false; error: DomainError } {
  const outline = state.outline;
  if (outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
  const step = outline.content.steps[targetIndex];
  if (step === undefined) {
    return fail('E_UNKNOWN_OUTLINE_STEP', `there is no outline step at index ${targetIndex}`);
  }

  const closed = closeActive(state, now);
  const { marks: _marks, meaning: _meaning, dictionary: _dictionary, listening: _listening, ...withoutInk } = closed;
  let navigated: SessionState = {
    ...withoutInk,
    activeInteractionId: null,
    outline: { ...outline, currentStepIndex: targetIndex, shownGroups: Math.min(1, resolveRevealOrder(step, outline.content.interactions).length) },
  };

  if (step.kind !== 'interaction') return { ok: true, state: clockAfterNavigate(navigated, now) };
  const runtime = closed.interactions[step.interactionId];
  if (runtime === undefined) {
    return fail(
      'E_UNKNOWN_INTERACTION',
      `outline step "${step.id}" references missing interaction "${step.interactionId}"`,
    );
  }
  const { resultsHidden: _hidden, closesAt: _timer, closedAt: _closed, ...rest } = runtime;
  const closesAt = armClosesAt(sessionInteraction(closed, step.interactionId), now);
  navigated = {
    ...withRuntime(navigated, step.interactionId, {
      ...rest,
      status: 'open',
      openedAt: now,
      ...(closesAt === undefined ? {} : { closesAt }),
    }),
    activeInteractionId: step.interactionId,
  };
  return { ok: true, state: clockAfterNavigate(navigated, now) };
}

export function isPeerInstruction(interaction: NormalizedInteraction): boolean {
  return interaction.type === 'choice' && interaction.peerInstruction === true;
}

type BuiltBallot = { ballot: Ballot } | { error: string };
