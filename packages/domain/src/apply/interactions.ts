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
import { isPeerInstruction } from './helpers.js';

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

/** **Question lifecycle**: open, close, reveal, results visibility, revote. */
export function applyInteractionCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'interaction.open': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      const closed = closeActive(state, now);
      const current = closed.interactions[command.interactionId] ?? runtime;
      const { resultsHidden: _cleared, closesAt: _oldTimer, closedAt: _oldClose, ...rest } =
        current;
      const closesAt = armClosesAt(sessionInteraction(closed, command.interactionId), now);
      return commit({
        ...withRuntime(closed, command.interactionId, {
          ...rest,
          status: 'open',
          openedAt: now,
          ...(closesAt !== undefined ? { closesAt } : {}),
        }),
        activeInteractionId: command.interactionId,
      });
    }

    case 'interaction.close': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (runtime.status !== 'open') {
        return fail('E_INVALID_TRANSITION', `interaction is "${runtime.status}", not open`);
      }
      return commit(withRuntime(state, command.interactionId, closeRuntime(runtime, now)));
    }

    case 'interaction.reveal': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (runtime.status === 'pending') {
        return fail('E_INVALID_TRANSITION', 'cannot reveal an interaction that never opened');
      }
      const { resultsHidden: _cleared, closesAt: _timer, ...rest } = runtime;
      return commit(
        withRuntime(state, command.interactionId, {
          ...rest,
          status: 'revealed',
          closedAt: runtime.closedAt ?? now,
        }),
      );
    }

    case 'interaction.hideResults': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (runtime.status === 'pending') {
        return fail('E_INVALID_TRANSITION', 'cannot hide results for an interaction that never opened');
      }
      return commit(
        withRuntime(state, command.interactionId, {
          ...runtime,
          resultsHidden: true,
        }),
      );
    }

    case 'interaction.showResults': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (runtime.status === 'pending') {
        return fail('E_INVALID_TRANSITION', 'cannot show results for an interaction that never opened');
      }
      if (runtime.resultsHidden !== true) {
        return noop(state);
      }
      const { resultsHidden: _cleared, ...rest } = runtime;
      return commit(withRuntime(state, command.interactionId, rest));
    }

    case 'interaction.revote': {
      const runtime = state.interactions[command.interactionId];
      const interaction = sessionInteraction(state, command.interactionId);
      if (runtime === undefined || interaction === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (!isPeerInstruction(interaction)) {
        return fail(
          'E_INVALID_TRANSITION',
          `interaction "${interaction.id}" is not a peer-instruction interaction`,
        );
      }
      if (runtime.status !== 'closed') {
        return fail(
          'E_INVALID_TRANSITION',
          `a revote needs a closed interaction; "${interaction.id}" is "${runtime.status}"`,
        );
      }
      // round 2 is handled as an idempotent no-op above; anything else is a bug.
      if ((runtime.round ?? 1) !== 1) {
        return fail('E_INVALID_TRANSITION', 'this interaction has already been revoted');
      }
      const closed = closeActive(state, now);
      const current = closed.interactions[command.interactionId] ?? runtime;
      const closesAt = armClosesAt(interaction, now);
      const reopened: InteractionRuntime = {
        status: 'open',
        ballots: {},
        aggregate: emptyAggregate(interaction),
        openedAt: now,
        round: 2,
        round1: { ballots: current.ballots, aggregate: current.aggregate },
        ...(closesAt !== undefined ? { closesAt } : {}),
      };
      return commit({
        ...withRuntime(closed, command.interactionId, reopened),
        activeInteractionId: command.interactionId,
      });
    }

    case 'interaction.undoRevote': {
      const runtime = state.interactions[command.interactionId];
      const interaction = sessionInteraction(state, command.interactionId);
      if (runtime === undefined || interaction === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (!isPeerInstruction(interaction)) {
        return fail(
          'E_INVALID_TRANSITION',
          `interaction "${interaction.id}" is not a peer-instruction interaction`,
        );
      }
      // Already in round 1 (or never revoted): idempotent no-op above.
      if (runtime.round1 === undefined || (runtime.round ?? 1) !== 2) {
        return fail(
          'E_INVALID_TRANSITION',
          'nothing to undo — this interaction is not in round 2',
        );
      }
      const restored: InteractionRuntime = {
        status: 'closed',
        ballots: runtime.round1.ballots,
        aggregate: runtime.round1.aggregate,
        openedAt: runtime.openedAt,
        closedAt: now,
        round: 1,
        // no round1 archive — host is back on the first tally; drop any timer
      };
      return commit({
        ...withRuntime(state, command.interactionId, restored),
        activeInteractionId: command.interactionId,
      });
    }

    default:
      return undefined;
  }
}
