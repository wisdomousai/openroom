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
import { buildBallot } from './ballot.js';
import { groupBallotKey, participantGroup } from '../groups.js';

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

/** **Text answers**: wall-text moderation and poll submission. */
export function applyTextCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'text.hide':
    case 'text.unhide': {
      const runtime = state.interactions[command.interactionId];
      const interaction = sessionInteraction(state, command.interactionId);
      if (runtime === undefined || interaction === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      const ballot = runtime.ballots[command.participantId];
      if (ballot === undefined || (ballot.kind !== 'text' && ballot.kind !== 'qna')) {
        return fail(
          'E_INVALID_ANSWER',
          `participant "${command.participantId}" has no text entry on "${command.interactionId}"`,
        );
      }
      const hidden = command.command === 'text.hide';
      if (ballot.hidden === hidden) return noop(state);
      const ballots: Record<string, Ballot> = {
        ...runtime.ballots,
        [command.participantId]: { ...ballot, hidden },
      };
      return commit(
        withRuntime(state, command.interactionId, {
          ...runtime,
          ballots,
          aggregate: computeAggregate(interaction, ballots),
        }),
      );
    }

    case 'answer.submit': {
      const participantId = actor.participantId as string;
      const runtime = state.interactions[command.interactionId];
      const interaction = sessionInteraction(state, command.interactionId);
      if (runtime === undefined || interaction === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (runtime.status !== 'open') {
        return fail('E_NOT_OPEN', `interaction "${command.interactionId}" is not open`);
      }
      const group = interaction.responseMode === 'group' ? participantGroup(state, participantId) : undefined;
      if (interaction.responseMode === 'group' && (!group || group.spokespersonId !== participantId || command.groupId !== group.id)) {
        return fail('E_FORBIDDEN', 'Only the assigned group spokesperson can submit this response.');
      }
      const ballotKey = group ? groupBallotKey(group.id) : participantId;
      const existing = runtime.ballots[ballotKey];
      if (existing !== undefined && !interaction.allowAnswerChange) {
        return fail('E_FORBIDDEN', 'answer changes are disabled for this interaction');
      }
      const built = buildBallot(interaction, command.answer, existing);
      if ('error' in built) return fail('E_INVALID_ANSWER', built.error);

      const ballots: Record<string, Ballot> = {
        ...runtime.ballots,
        [ballotKey]: built.ballot,
      };
      const withParticipant = ensureParticipant(state, participantId, now);
      return commit(
        withRuntime(withParticipant, command.interactionId, {
          ...runtime,
          ballots,
          ...(group ? { groupNames: { ...runtime.groupNames, [ballotKey]: runtime.groupNames?.[ballotKey] ?? group.name } } : {}),
          aggregate: computeAggregate(interaction, ballots),
        }),
      );
    }

    default:
      return undefined;
  }
}
