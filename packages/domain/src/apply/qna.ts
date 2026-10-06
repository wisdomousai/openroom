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

/** **Session-wide audience Q&A**: ask, vote, moderate, stage. */
export function applyQnaCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'qna.vote': {
      const participantId = actor.participantId as string;
      const runtime = state.interactions[command.interactionId];
      const interaction = sessionInteraction(state, command.interactionId);
      if (runtime === undefined || interaction === undefined) {
        return fail('E_UNKNOWN_INTERACTION', `no interaction "${command.interactionId}"`);
      }
      if (interaction.type !== 'qna') {
        return fail('E_INVALID_ANSWER', `interaction "${interaction.id}" is not a Q&A`);
      }
      if (runtime.status !== 'open') {
        return fail('E_NOT_OPEN', `interaction "${command.interactionId}" is not open`);
      }
      const target = runtime.ballots[command.targetParticipantId];
      if (target === undefined || target.kind !== 'qna') {
        return fail('E_INVALID_ANSWER', 'there is no question to vote for');
      }
      if (target.voters.includes(participantId)) {
        return fail('E_FORBIDDEN', 'you have already voted for this question');
      }
      const voters = [...target.voters, participantId];
      const ballots: Record<string, Ballot> = {
        ...runtime.ballots,
        [command.targetParticipantId]: { ...target, voters, votes: voters.length },
      };
      const withParticipant = ensureParticipant(state, participantId, now);
      return commit(
        withRuntime(withParticipant, command.interactionId, {
          ...runtime,
          ballots,
          aggregate: computeAggregate(interaction, ballots),
        }),
      );
    }

    case 'qna.ask': {
      const participantId = actor.participantId as string;
      const qna = state.qna;
      if (!qna.enabled) {
        return fail('E_FORBIDDEN', 'audience Q&A is not enabled for this session');
      }
      const id = command.questionId;
      if (typeof id !== 'string' || id === '' || id.length > QNA_QUESTION_ID_MAX_LENGTH) {
        return fail('E_INVALID_ANSWER', 'invalid question id');
      }
      if (typeof command.text !== 'string') {
        return fail('E_INVALID_ANSWER', 'questions must be text');
      }
      const text = command.text.trim();
      if (text === '') return fail('E_INVALID_ANSWER', 'questions cannot be empty');
      const maxLength = qnaMaxLength(state);
      if (text.length > maxLength) {
        return fail('E_INVALID_ANSWER', `questions are limited to ${maxLength} characters`);
      }
      const existing = qna.questions[id];
      if (existing !== undefined && existing.participantId !== participantId) {
        return fail('E_FORBIDDEN', 'that question belongs to someone else');
      }
      // Retry safety: re-asking the identical question is a silent success.
      if (existing !== undefined && existing.text === text) return noop(state);
      // Editing keeps accrued votes and the original timestamp, like block-Q&A.
      const question: QnaQuestion =
        existing === undefined
          ? {
              id,
              participantId,
              text,
              hidden: applyBlocklist(text).hidden,
              votes: 0,
              voters: [],
              createdAt: now,
            }
          : { ...existing, text, hidden: applyBlocklist(text).hidden };
      const withParticipant = ensureParticipant(state, participantId, now);
      return commit({
        ...withParticipant,
        qna: { ...qna, questions: { ...qna.questions, [id]: question } },
      });
    }

    case 'qna.upvote': {
      const participantId = actor.participantId as string;
      const qna = state.qna;
      if (!qna.enabled) {
        return fail('E_FORBIDDEN', 'audience Q&A is not enabled for this session');
      }
      const question = qna.questions[command.questionId];
      if (question === undefined) {
        return fail('E_INVALID_ANSWER', 'there is no question to upvote');
      }
      if (question.voters.includes(participantId)) {
        return fail('E_FORBIDDEN', 'you have already upvoted this question');
      }
      const voters = [...question.voters, participantId];
      const withParticipant = ensureParticipant(state, participantId, now);
      return commit({
        ...withParticipant,
        qna: {
          ...qna,
          questions: {
            ...qna.questions,
            [command.questionId]: { ...question, voters, votes: voters.length },
          },
        },
      });
    }

    case 'qna.hide':
    case 'qna.unhide': {
      const qna = state.qna;
      const question = qna.questions[command.questionId];
      if (question === undefined) {
        return fail('E_INVALID_ANSWER', `no question "${command.questionId}"`);
      }
      const hidden = command.command === 'qna.hide';
      // Hiding the spotlighted question would leave a blanked entry on the
      // projector; fall back to the list instead.
      const stage: QnaStagePlacement =
        hidden && qna.stage.mode === 'spotlight' && qna.stage.questionId === command.questionId
          ? { mode: 'list' }
          : qna.stage;
      return commit({
        ...state,
        qna: {
          ...qna,
          stage,
          questions: { ...qna.questions, [command.questionId]: { ...question, hidden } },
        },
      });
    }

    case 'qna.stage': {
      const qna = state.qna;
      if (!qna.enabled) {
        return fail('E_FORBIDDEN', 'audience Q&A is not enabled for this session');
      }
      if (command.mode === 'spotlight') {
        const question =
          command.questionId === undefined ? undefined : qna.questions[command.questionId];
        if (question === undefined || question.hidden) {
          return fail('E_INVALID_ANSWER', 'spotlight needs a visible question');
        }
        return commit({
          ...state,
          qna: { ...qna, stage: { mode: 'spotlight', questionId: question.id } },
        });
      }
      return commit({ ...state, qna: { ...qna, stage: { mode: command.mode } } });
    }

    default:
      return undefined;
  }
}
