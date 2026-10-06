import {
  isPresentationPosition,
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

/** **Session lifecycle**: start / end / freeze / theme / display / timers. */
export function applySessionCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'session.start': {
      if (state.status !== 'lobby') {
        return fail('E_INVALID_TRANSITION', `cannot start a session in status "${state.status}"`);
      }
      if (command.cursor !== undefined) {
        const cursor = command.cursor;
        const outline = state.outline;
        if (!isPresentationPosition(outline.content, cursor)) {
          return fail('E_INVALID_OUTLINE_STEP', 'invalid presentation cursor');
        }
        const index = outline.content.steps.findIndex((step) => step.id === cursor.stepId);
        const activated = navigateOutline({ ...state, status: 'live' }, index, now);
        return activated.ok ? commit({ ...activated.state,
          outline: { ...activated.state.outline!, shownGroups: cursor.shown },
          ...(cursor.listening ? { listening: { stepId: cursor.stepId, mode: cursor.listening.mode, transcriptShown: cursor.listening.transcriptShown } } : {}),
        }) : activated;
      }
      // Tutoring outlines activate step 0 immediately so interaction-first
      // decks open their first poll. A compiled poll list (every step is an
      // interaction whose id equals the question id) stays in the live lobby
      // until the host opens a question — same as session.advance.
      if (!isPollOnlyOutline(state.outline)) {
        const activated = navigateOutline({ ...state, status: 'live' }, state.outline.currentStepIndex, now);
        return activated.ok ? commit(activated.state) : activated;
      }
      return commit({ ...state, status: 'live' });
    }

    case 'session.end': {
      const closed = closeActive(state, now);
      return commit({ ...closed, status: 'ended', endedAt: now });
    }

    case 'session.freeze':
      return commit({ ...state, frozen: true });

    case 'session.unfreeze':
      return commit({ ...state, frozen: false });

    case 'session.theme': {
      // An identical theme is an idempotent no-op handled above (before the
      // expectedRevision check), so reaching here means a real change.
      if (!isKnownTheme(command.theme)) {
        return fail(
          'E_INVALID_THEME',
          `unknown theme "${String(command.theme)}"; expected one of ${SESSION_THEME_IDS.join(', ')}`,
        );
      }
      return commit({ ...state, theme: command.theme });
    }

    case 'session.display': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      const activeId = state.activeInteractionId;
      if (activeId === null) {
        return fail('E_INVALID_TRANSITION', 'no interaction is open to override');
      }
      const interaction = sessionInteraction(state, activeId);
      const runtime = state.interactions[activeId];
      if (interaction === undefined || runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${activeId}"`);
      }
      const allowed = displaysFor(interaction.type);
      if (!allowed.includes(command.display)) {
        return fail(
          'E_INVALID_DISPLAY',
          `display "${command.display}" is not valid for type "${interaction.type}" (allowed: ${allowed.join(', ')})`,
        );
      }
      return commit(
        withRuntime(state, activeId, { ...runtime, displayOverride: command.display }),
      );
    }

    case 'timer.start':
    case 'timer.pause':
    case 'timer.reset':
    case 'timer.adjust': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      if (state.outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');

      const existing = state.clock;
      const bound = existing === undefined ? undefined : timerStepById(state, existing.stepId);
      const current = currentTimerStep(state);
      const source = bound ?? current;
      if (source === undefined) {
        return fail('E_INVALID_TRANSITION', 'there is no timer on this slide');
      }

      if (command.command === 'timer.start') {
        const clock =
          existing === undefined
            ? clockFromStep(source, now, true)
            : {
                ...existing,
                remainingSec: remainingNow(existing, now),
                remainingSecAt: now,
                running: true,
              };
        return commit({ ...state, clock });
      }

      if (command.command === 'timer.pause') {
        if (existing === undefined) {
          return fail('E_INVALID_TRANSITION', 'the clock has not started');
        }
        return commit({
          ...state,
          clock: {
            ...existing,
            remainingSec: remainingNow(existing, now),
            remainingSecAt: now,
            running: false,
          },
        });
      }

      if (command.command === 'timer.reset') {
        const authored = source.seconds;
        const clock: SessionClock = {
          stepId: source.id,
          authoredSec: authored,
          remainingSecAt: now,
          remainingSec: authored,
          running: false,
          placement: existing?.placement ?? (source.placement === 'corner' ? 'corner' : 'slide'),
        };
        return commit({ ...state, clock });
      }

      // timer.adjust
      if (typeof command.seconds !== 'number' || !Number.isFinite(command.seconds)) {
        return fail('E_INVALID_ANSWER', 'timer.adjust needs a finite seconds delta');
      }
      const base =
        existing ??
        clockFromStep(source, now, false);
      return commit({
        ...state,
        clock: {
          ...base,
          remainingSec: remainingNow(base, now) + command.seconds,
          remainingSecAt: now,
        },
      });
    }

    default:
      return undefined;
  }
}
