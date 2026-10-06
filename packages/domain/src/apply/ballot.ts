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
import { fail } from './helpers.js';

/** Ballot construction for answer submissions. */
export type BuiltBallot = { ballot: Ballot } | { error: string };

export function buildBallot(
  interaction: NormalizedInteraction,
  answer: AnswerInput,
  existing: Ballot | undefined,
): BuiltBallot {
  if (answer.kind === 'dont-know') {
    if (!interaction.allowDontKnow) {
      return { error: `"I don't know" is not enabled for this interaction` };
    }
    return { ballot: { kind: 'dont-know' } };
  }

  if (answer.kind !== interaction.type) {
    return { error: `answer kind "${answer.kind}" does not match type "${interaction.type}"` };
  }

  switch (interaction.type) {
    case 'choice': {
      if (answer.kind !== 'choice') return { error: 'expected a choice answer' };
      const ids = answer.optionIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        return { error: 'select at least one option' };
      }
      if (new Set(ids).size !== ids.length) {
        return { error: 'duplicate option in selection' };
      }
      if (!interaction.multiple && ids.length !== 1) {
        return { error: 'this question accepts exactly one option' };
      }
      if (ids.length > interaction.options.length) {
        return { error: 'too many options selected' };
      }
      const valid = new Set(interaction.options.map((option) => option.id));
      for (const id of ids) {
        if (!valid.has(id)) return { error: `unknown option "${id}"` };
      }
      return { ballot: { kind: 'choice', optionIds: [...ids] } };
    }
    case 'scale': {
      if (answer.kind !== 'scale') return { error: 'expected a scale answer' };
      const value = answer.value;
      if (!Number.isInteger(value)) return { error: 'scale answers must be whole numbers' };
      if (value < interaction.min || value > interaction.max) {
        return { error: `value must be between ${interaction.min} and ${interaction.max}` };
      }
      return { ballot: { kind: 'scale', value } };
    }
    case 'numeric': {
      if (answer.kind !== 'numeric') return { error: 'expected a numeric answer' };
      if (typeof answer.value !== 'number' || !Number.isFinite(answer.value)) {
        return { error: 'value must be a finite number' };
      }
      return { ballot: { kind: 'numeric', value: answer.value } };
    }
    case 'text': {
      if (answer.kind !== 'text') return { error: 'expected a text answer' };
      const text = answer.text.trim();
      if (text === '') return { error: 'text answers cannot be empty' };
      if (text.length > interaction.maxLength) {
        return { error: `text answers are limited to ${interaction.maxLength} characters` };
      }
      return { ballot: { kind: 'text', text, hidden: applyBlocklist(text).hidden } };
    }
    case 'ranking': {
      if (answer.kind !== 'ranking') return { error: 'expected a ranking answer' };
      const ids = answer.optionIds;
      if (!Array.isArray(ids)) return { error: 'a ranking must be a list of option ids' };
      const valid = interaction.options.map((option) => option.id);
      if (ids.length !== valid.length) {
        return { error: `rank all ${valid.length} options, got ${ids.length}` };
      }
      if (new Set(ids).size !== ids.length) {
        return { error: 'an option may only appear once in a ranking' };
      }
      const allowed = new Set(valid);
      for (const id of ids) {
        if (!allowed.has(id)) return { error: `unknown option "${id}"` };
      }
      return { ballot: { kind: 'ranking', optionIds: [...ids] } };
    }
    case 'fill-the-gaps': {
      if (answer.kind !== 'fill-the-gaps') return { error: 'expected a fill-the-gaps answer' };
      const expected = new Set(interaction.gaps.map((gap) => gap.id));
      const gaps: Record<string, string> = {};
      let hidden = false;
      for (const gap of interaction.gaps) {
        const raw = answer.gaps[gap.id];
        if (typeof raw !== 'string') return { error: `fill every gap (missing "${gap.id}")` };
        const text = raw.trim();
        if (text === '') return { error: `fill every gap (missing "${gap.id}")` };
        if (text.length > 200) return { error: 'a gap answer is too long' };
        const blocked = applyBlocklist(text);
        if (blocked.hidden) hidden = true;
        gaps[gap.id] = text;
      }
      for (const key of Object.keys(answer.gaps)) {
        if (!expected.has(key)) return { error: `unknown gap "${key}"` };
      }
      return { ballot: { kind: 'fill-the-gaps', gaps, hidden } };
    }
    case 'match': {
      if (answer.kind !== 'match') return { error: 'expected a match answer' };
      const leftIds = interaction.left.map((item) => item.id);
      const rightIds = new Set(interaction.right.map((item) => item.id));
      const pairs: Record<string, string> = {};
      const used = new Set<string>();
      for (const leftId of leftIds) {
        const rightId = answer.pairs[leftId];
        if (typeof rightId !== 'string') return { error: 'pair every item' };
        if (!rightIds.has(rightId)) return { error: `unknown match "${rightId}"` };
        if (used.has(rightId)) return { error: 'each match can only be used once' };
        used.add(rightId);
        pairs[leftId] = rightId;
      }
      return { ballot: { kind: 'match', pairs } };
    }
    case 'qna': {
      if (answer.kind !== 'qna') return { error: 'expected a question' };
      const text = answer.text.trim();
      if (text === '') return { error: 'questions cannot be empty' };
      if (text.length > 500) return { error: 'questions are limited to 500 characters' };
      // Editing a question keeps the votes it has already collected.
      const previousVoters = existing !== undefined && existing.kind === 'qna' ? existing.voters : [];
      return {
        ballot: {
          kind: 'qna',
          text,
          hidden: applyBlocklist(text).hidden,
          votes: previousVoters.length,
          voters: [...previousVoters],
        },
      };
    }
    default: {
      const never: never = interaction;
      return { error: `unknown interaction type: ${JSON.stringify(never)}` };
    }
  }
}
