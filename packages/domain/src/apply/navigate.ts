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
import {
  armClosesAt,
  closeActive,
  closeRuntime,
  commit,
  currentTimerStep,
  clockAfterNavigate,
  clockFromStep,
  ensureParticipant,
  fail,
  navigateOutline,
  noop,
  remainingNow,
  sessionInteraction,
  timerStepById,
  withRuntime,
} from './helpers.js';

/** **Navigation**: advance, goto, next / previous. */
export function applyNavigateCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'session.advance': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      const next = sessionOf(state).interactions.find(
        (interaction) => state.interactions[interaction.id]?.status === 'pending',
      );
      if (next === undefined) {
        return fail('E_INVALID_TRANSITION', 'there is no pending interaction left to open');
      }
      const closed = closeActive(state, now);
      const runtime = closed.interactions[next.id];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${next.id}"`);
      }
      const { closesAt: _oldTimer, closedAt: _oldClose, ...rest } = runtime;
      const closesAt = armClosesAt(next, now);
      return commit({
        ...withRuntime(closed, next.id, {
          ...rest,
          status: 'open',
          openedAt: now,
          ...(closesAt !== undefined ? { closesAt } : {}),
        }),
        activeInteractionId: next.id,
      });
    }

    case 'outline.goto': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      if (state.outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
      const index = state.outline.content.steps.findIndex((step) => step.id === command.stepId);
      if (index < 0) {
        return fail('E_UNKNOWN_OUTLINE_STEP', `no outline step "${command.stepId}"`);
      }
      const navigated = navigateOutline(state, index, now);
      return navigated.ok ? commit(navigated.state) : navigated;
    }

    case 'outline.reveal': {
      if (state.status !== 'live' || !state.outline) return fail('E_INVALID_TRANSITION', 'the session is not live');
      const outline = state.outline;
      const step = outline.content.steps[outline.currentStepIndex];
      if (!step || step.id !== command.stepId || !Number.isInteger(command.shown) || command.shown < 0 || command.shown > resolveRevealOrder(step, outline.content.interactions).length) {
        return fail('E_INVALID_OUTLINE_STEP', 'invalid reveal position for the current slide');
      }
      if (outline.shownGroups === command.shown) return noop(state);
      return commit({ ...state, outline: { ...outline, shownGroups: command.shown } });
    }

    case 'outline.next':
    case 'outline.previous': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      if (state.outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
      const outline = state.outline;
      const current = outline.content.steps[outline.currentStepIndex]!;
      const count = resolveRevealOrder(current, outline.content.interactions).length;
      const shown = outline.shownGroups ?? count;
      if (command.command === 'outline.next' && shown < count) {
        return commit({ ...state, outline: { ...outline, shownGroups: shown + 1 } });
      }
      if (command.command === 'outline.previous' && shown > 1) {
        return commit({ ...state, outline: { ...outline, shownGroups: shown - 1 } });
      }
      const delta = command.command === 'outline.next' ? 1 : -1;
      let index = outline.currentStepIndex + delta;
      while (outline.content.steps[index]?.breakoutOf !== undefined) index += delta;
      const navigated = navigateOutline(state, index, now);
      if (!navigated.ok) return navigated;
      if (delta < 0) navigated.state.outline!.shownGroups = resolveRevealOrder(outline.content.steps[index]!, outline.content.interactions).length;
      return commit(navigated.state);
    }

    default:
      return undefined;
  }
}
