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
/**
 * Commands whose effect is already present in the state. These succeed without
 * bumping the revision, and crucially they are checked before `expectedRevision`
 * so a retried command never turns into a revision conflict.
 */
export function detectNoop(state: SessionState, command: Command): boolean {
  switch (command.command) {
    case 'interaction.open':
      return state.interactions[command.interactionId]?.status === 'open';
    case 'interaction.reveal': {
      const runtime = state.interactions[command.interactionId];
      return runtime?.status === 'revealed' && runtime.resultsHidden !== true;
    }
    case 'interaction.hideResults': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined || runtime.status === 'pending') return false;
      return runtime.resultsHidden === true;
    }
    case 'interaction.showResults': {
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined || runtime.status === 'pending') return false;
      return runtime.resultsHidden !== true;
    }
    case 'interaction.revote':
      // Retry safety: a revote that already happened must not fail, and must
      // not archive round 2 over round 1 (checked before expectedRevision).
      return state.interactions[command.interactionId]?.round === 2;
    case 'interaction.undoRevote': {
      // Already back on round 1 (or never revoted): retry is a silent success.
      const runtime = state.interactions[command.interactionId];
      if (runtime === undefined) return false;
      return runtime.round1 === undefined || (runtime.round ?? 1) !== 2;
    }
    case 'session.theme':
      // Re-sending the theme the session already has must not bump the revision
      // and must not turn into a revision conflict on a retry.
      return state.theme === command.theme;
    case 'session.display': {
      const activeId = state.activeInteractionId;
      if (activeId === null) return false;
      return state.interactions[activeId]?.displayOverride === command.display;
    }
    case 'timer.start':
      return state.clock?.running === true;
    case 'timer.pause':
      return state.clock !== undefined && state.clock.running === false;
    case 'timer.reset': {
      const clock = state.clock;
      if (clock === undefined) return false;
      return !clock.running && clock.remainingSec === clock.authoredSec;
    }
    case 'timer.adjust':
      return command.seconds === 0 && state.clock !== undefined;
    // outline.goto is intentionally not a detectNoop when the step is already
    // current: navigateOutline re-opens a closed/pending interaction and is the
    // only way to re-activate step 0 after a soft land. Retries that truly
    // no-op are rare and safe to re-apply (open stays open).
    case 'session.freeze':
      return state.frozen;
    case 'session.unfreeze':
      return !state.frozen;
    case 'qna.hide':
    case 'qna.unhide': {
      const question = state.qna.questions[command.questionId];
      if (question === undefined) return false;
      return question.hidden === (command.command === 'qna.hide');
    }
    case 'qna.stage': {
      const stage = state.qna.stage;
      if (stage.mode !== command.mode) return false;
      return stage.mode !== 'spotlight' || stage.questionId === command.questionId;
    }
    default:
      return false;
  }
}

/** True for a choice interaction configured as a peer-instruction cycle. */
