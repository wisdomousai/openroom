import {
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

/** **Structured outline writes**: insert and replace steps mid-session. */
export function applyWriteCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'outline.insert': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      const outline = state.outline;
      if (outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
      const afterIndex = command.afterStepId === undefined
        ? outline.currentStepIndex
        : outline.content.steps.findIndex((step) => step.id === command.afterStepId);
      if (afterIndex < 0) {
        return fail('E_UNKNOWN_OUTLINE_STEP', `no outline step "${String(command.afterStepId)}"`);
      }

      let outlineInteractions = outline.content.interactions;
      if (command.step.kind === 'interaction') {
        const interaction = command.interaction;
        if (interaction === undefined) {
          return fail('E_INVALID_OUTLINE_STEP', 'an interaction step needs a poll definition');
        }
        if (interaction.id !== command.step.interactionId) {
          return fail('E_INVALID_OUTLINE_STEP', 'interaction id must match the step');
        }
        if (outline.content.interactions.some((row) => row.id === interaction.id)) {
          return fail('E_INVALID_OUTLINE_STEP', `interaction "${interaction.id}" already exists`);
        }
        outlineInteractions = [...outline.content.interactions, interaction as Interaction];
      } else if (command.interaction !== undefined) {
        return fail('E_INVALID_OUTLINE_STEP', 'interaction is only valid with an interaction step');
      }

      const steps: OutlineStep[] = [
        ...outline.content.steps.slice(0, afterIndex + 1),
        command.step,
        ...outline.content.steps.slice(afterIndex + 1),
      ];
      const validation = validateOutline({
        ...outline.content,
        steps,
        interactions: outlineInteractions,
      });
      if (!validation.ok) {
        return fail('E_INVALID_OUTLINE_STEP', validation.errors[0]?.message ?? 'invalid outline step');
      }
      let base: SessionState = state;
      if (command.step.kind === 'interaction' && command.interaction !== undefined) {
        const normalized = normalizeSession(validation.session).interactions.find(
          (row) => row.id === command.interaction!.id,
        );
        if (normalized === undefined) {
          return fail('E_INVALID_OUTLINE_STEP', 'interaction did not normalize');
        }
        const runtime: InteractionRuntime = {
          status: 'pending',
          ballots: {},
          aggregate: emptyAggregate(normalized),
        };
        if (normalized.type === 'choice' && normalized.peerInstruction) runtime.round = 1;
        base = {
          ...state,
          interactions: { ...state.interactions, [command.interaction.id]: runtime },
        };
      }
      const insertedIndex = afterIndex + 1;
      // Inserting before the live cursor shifts later steps right; keep the
      // host on the same authored step unless they asked to show the insert.
      const currentStepIndex = afterIndex < outline.currentStepIndex
        ? outline.currentStepIndex + 1
        : outline.currentStepIndex;
      const withStep: SessionState = {
        ...base,
        outline: {
          content: validation.outline,
          outlineVersion: outline.outlineVersion,
          currentStepIndex,
        },
      };
      if (command.show !== true) return commit(withStep);
      const navigated = navigateOutline(withStep, insertedIndex, now);
      return navigated.ok ? commit(navigated.state) : navigated;
    }

    case 'outline.replace': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      const outline = state.outline;
      if (outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
      const index = outline.content.steps.findIndex((step) => step.id === command.stepId);
      if (index < 0) {
        return fail('E_UNKNOWN_OUTLINE_STEP', `no outline step "${command.stepId}"`);
      }
      const existing = outline.content.steps[index];
      if (existing === undefined) {
        return fail('E_UNKNOWN_OUTLINE_STEP', `no outline step "${command.stepId}"`);
      }
      if (existing.kind === 'interaction' || command.step.kind === 'interaction') {
        return fail(
          'E_INVALID_OUTLINE_STEP',
          'live replace is for content slides only — not open polls',
        );
      }
      const nextStep: OutlineStep = { ...command.step, id: command.stepId };
      const steps = outline.content.steps.map((step, i) => (i === index ? nextStep : step));
      const validation = validateOutline({ ...outline.content, steps });
      if (!validation.ok) {
        return fail('E_INVALID_OUTLINE_STEP', validation.errors[0]?.message ?? 'invalid outline step');
      }
      const { listening, ...rest } = state;
      return commit({
        ...rest,
        ...(index !== outline.currentStepIndex && listening ? { listening } : {}),
        outline: { ...outline, content: validation.outline },
      });
    }

    default:
      return undefined;
  }
}
