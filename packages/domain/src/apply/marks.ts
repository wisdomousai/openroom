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
import { MAX_DICTIONARY_BYTES, MAX_MARK_POINTS, MAX_ROOM_MARKS } from './helpers.js';

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

/** **Ink and meaning**: marks and deliberately published word cards. */
export function applyMarkCommands(
  state: SessionState,
  command: Command,
  actor: CommandEnvelope['actor'],
  now: number,
): ApplyResult | undefined {
  switch (command.command) {
    case 'mark.set': {
      if (state.status !== 'live') {
        return fail('E_INVALID_TRANSITION', 'the session is not live');
      }
      if (state.outline === undefined) return fail('E_NO_OUTLINE', 'this session has no tutoring outline');
      const incoming = command.mark;
      if (incoming.color !== undefined && !INK_COLORS.includes(incoming.color)) {
        return fail('E_INVALID_ANSWER', 'unknown ink colour');
      }
      // Ink drawn before the colour existed is red — the tutor's first pen.
      const color: InkColor = incoming.color ?? 'red';
      // The revision this mark is about to land on is its name.
      const id = `m${String(state.revision + 1)}`;
      let mark: SessionMark;
      if (incoming.kind !== 'pen' && TOKEN_MARK_KINDS.includes(incoming.kind)) {
        if (!incoming.partKey || incoming.token < 0 || !Number.isInteger(incoming.token)) {
          return fail('E_INVALID_ANSWER', `${incoming.kind} mark needs a part and a word`);
        }
        const { endToken, ...shape } = incoming;
        if (endToken !== undefined && (!Number.isInteger(endToken) || endToken < incoming.token)) {
          return fail('E_INVALID_ANSWER', 'a marked span ends at or after its first word');
        }
        // A span of one is a word: stored without an end, so one shape reaches
        // the surfaces however the tutor drew it.
        mark =
          endToken === undefined || endToken === incoming.token
            ? { ...shape, color, id }
            : { ...shape, endToken, color, id };
      } else if (incoming.kind === 'pen') {
        if (!Array.isArray(incoming.points) || incoming.points.length === 0) {
          return fail('E_INVALID_ANSWER', 'pen mark needs points');
        }
        // A stroke is a gesture, not a recording: the tail beyond the cap is
        // dropped rather than the stroke rejected, so a long drag still draws.
        mark = { ...incoming, points: incoming.points.slice(0, MAX_MARK_POINTS), color, id };
      } else {
        return fail('E_INVALID_ANSWER', 'unknown mark');
      }
      const marks = [...(state.marks ?? []), mark];
      if (marks.length > MAX_ROOM_MARKS) {
        return fail('E_INVALID_ANSWER', 'too much ink on this step — clear it first');
      }
      return commit({ ...state, marks });
    }

    case 'mark.remove': {
      if (typeof command.id !== 'string' || command.id === '') {
        return fail('E_INVALID_ANSWER', 'mark.remove needs the id of a mark');
      }
      const remaining = (state.marks ?? []).filter((mark) => mark.id !== command.id);
      // Rubbing out a mark that is already gone is what a retry looks like.
      if (remaining.length === (state.marks ?? []).length) return noop(state);
      if (remaining.length === 0) {
        const { marks: _dropped, ...rest } = state;
        return commit(rest);
      }
      return commit({ ...state, marks: remaining });
    }

    case 'mark.clear': {
      if (
        state.marks === undefined &&
        state.meaning === undefined &&
        state.dictionary === undefined
      ) {
        return noop(state);
      }
      // Clear takes the plate back: the meaning and the table are ink too.
      const { marks: _m, meaning: _g, dictionary: _d, ...rest } = state;
      return commit(rest);
    }

    case 'meaning.publish': {
      if (state.status !== 'live') return fail('E_INVALID_TRANSITION', 'the session is not live');
      const current = state.outline?.content.steps[state.outline.currentStepIndex];
      if (!current || current.id !== command.stepId) return fail('E_REVISION_CONFLICT', 'the slide has changed');
      if (typeof command.partKey !== 'string' || !command.partKey || command.partKey.length > 256 || !Number.isInteger(command.token) || command.token < 0 || command.token > 10_000) return fail('E_INVALID_ANSWER', 'a meaning needs a slide part and word');
      if (typeof command.word !== 'string' || !command.word.trim() || command.word.length > 60) return fail('E_INVALID_ANSWER', 'a meaning needs a word');
      if (command.text !== undefined && (typeof command.text !== 'string' || command.text.length > 200)) return fail('E_INVALID_ANSWER', 'a meaning is limited to 200 characters');
      const text = command.text?.trim() ?? '';
      const entry = command.entry === undefined ? null : parseDictionaryEntry(command.entry);
      if (command.entry !== undefined && (!entry || JSON.stringify(entry).length > MAX_DICTIONARY_BYTES)) return fail('E_INVALID_ANSWER', 'invalid or oversized dictionary entry');
      if (!text && !entry) return fail('E_INVALID_ANSWER', 'choose a meaning or forms to show');
      // One commit replaces both facts. Failure leaves the previous projection intact.
      const { meaning: _meaning, dictionary: _dictionary, ...rest } = state;
      return commit({ ...rest,
        ...(text ? { meaning: { partKey: command.partKey, token: command.token, word: command.word.trim(), text, shown: true } } : {}),
        ...(entry ? { dictionary: { id: `d${state.revision + 1}`, partKey: command.partKey, token: command.token, entry } } : {}),
      });
    }

    case 'meaning.clear': {
      const current = state.outline?.content.steps[state.outline.currentStepIndex];
      if (!current || current.id !== command.stepId) return noop(state);
      const projection = state.meaning ?? state.dictionary;
      if (!projection || projection.partKey !== command.partKey || projection.token !== command.token) return noop(state);
      const { meaning: _meaning, dictionary: _dictionary, ...rest } = state;
      return commit(rest);
    }

    default:
      return undefined;
  }
}
