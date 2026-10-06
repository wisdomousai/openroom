/**
 * FillTheGaps prompt tokenisation and ballot grading for the `fill-the-gaps` / `match` lanes.
 *
 * The `{{id}}` placeholder grammar is defined once here: the validator, the
 * phone answer form, the projector and the deck editor canvas all read it from this
 * file, so a prompt can never tokenise one way for the author and another way
 * for the session.
 */

import { MAX_FILL_THE_GAPS_GAPS, MIN_FILL_THE_GAPS_GAPS } from './schema.js';
import { normalizeTextAnswer, textAnswerMatches, type TextMatchOptions } from './text-match.js';

/** A gap id: lowercase alphanumerics in hyphen-joined groups (`g1`, `verb-2`). */
const PLACEHOLDER_SOURCE = '\\{\\{([a-z0-9]+(?:-[a-z0-9]+)*)\\}\\}';

/** Global matcher over a prompt. A fresh instance per call — `lastIndex` is state. */
export function fillTheGapsPlaceholderPattern(): RegExp {
  return new RegExp(PLACEHOLDER_SOURCE, 'g');
}

export type FillTheGapsToken = { kind: 'text'; text: string } | { kind: 'gap'; id: string };

/**
 * Split a fill-the-gaps prompt into literal text and gap tokens, in reading order.
 * Empty text spans between two adjacent placeholders are dropped, so a caller
 * can map straight over the result.
 */
export function splitFillTheGapsPrompt(prompt: string): FillTheGapsToken[] {
  const tokens: FillTheGapsToken[] = [];
  const pattern = fillTheGapsPlaceholderPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: prompt.slice(cursor, match.index) });
    tokens.push({ kind: 'gap', id: match[1] as string });
    cursor = match.index + match[0].length;
  }
  if (cursor < prompt.length) tokens.push({ kind: 'text', text: prompt.slice(cursor) });
  return tokens;
}

/** The distinct gap ids referenced by a prompt, in first-appearance order. */
export function fillTheGapsPlaceholderIds(prompt: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const token of splitFillTheGapsPrompt(prompt)) {
    if (token.kind !== 'gap' || seen.has(token.id)) continue;
    seen.add(token.id);
    ids.push(token.id);
  }
  return ids;
}

/**
 * The prompt as a reader sees it: every placeholder becomes `blank`, or the
 * gap's first accepted answer once the interaction carries answers (reveal).
 */
export function fillTheGapsPromptText(
  prompt: string,
  gaps?: readonly { id: string; answers?: readonly string[] }[],
  blank = '____',
): string {
  return splitFillTheGapsPrompt(prompt)
    .map((token) => {
      if (token.kind === 'text') return token.text;
      const answer = gaps?.find((gap) => gap.id === token.id)?.answers?.[0];
      return answer ?? blank;
    })
    .join('');
}

/**
 * The `{{id}}` ↔ `gaps` invariant the validator enforces as `E_FILL_THE_GAPS_GAPS`.
 *
 * Placeholder ids are compared as a set: writing `{{g1}}` twice is a broken
 * sentence, not a second gap. Authors see this while they type so a refused
 * save is never the first mention of the rule.
 */
export function fillTheGapsGapIssue(ix: {
  prompt: string;
  gaps: readonly { id: string }[];
}): string | null {
  const placeholders = [...splitFillTheGapsPrompt(ix.prompt)].filter((token) => token.kind === 'gap');
  const ids = new Set(placeholders.map((token) => token.id));
  if (ids.size !== placeholders.length) {
    return 'A gap placeholder may appear only once in the sentence.';
  }
  if (ids.size < MIN_FILL_THE_GAPS_GAPS) {
    return `Mark at least one gap with {{g1}}.`;
  }
  if (ids.size > MAX_FILL_THE_GAPS_GAPS) {
    return `A sentence can have at most ${String(MAX_FILL_THE_GAPS_GAPS)} gaps.`;
  }
  const gapIds = ix.gaps.map((gap) => gap.id);
  const missing = gapIds.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    return `No ${missing.map((id) => `{{${id}}}`).join(', ')} in the sentence — add it or remove the gap.`;
  }
  const extra = [...ids].filter((id) => !gapIds.includes(id));
  if (extra.length > 0) {
    return `${extra.map((id) => `{{${id}}}`).join(', ')} has no accepted answers yet.`;
  }
  return null;
}

/** An added gap is unfinished until the author enters an answer. */
export const FILL_THE_GAPS_GAP_STARTER_ANSWER = '';

export interface FillTheGapsGapDraft {
  id: string;
  answers: string[];
  distractors?: string[];
}

/**
 * Rebuild `gaps` from the placeholders in `prompt`, keeping answers for ids
 * that already exist. The prompt is the source of truth — this is how an
 * authoring surface stays inside `E_FILL_THE_GAPS_GAPS` without asking the author to
 * maintain two lists.
 */
export function gapsForFillTheGapsPrompt(
  prompt: string,
  previous: readonly FillTheGapsGapDraft[] = [],
): FillTheGapsGapDraft[] {
  const byId = new Map(previous.map((gap) => [gap.id, gap]));
  return fillTheGapsPlaceholderIds(prompt).map((id) => {
    const existing = byId.get(id);
    if (existing !== undefined) {
      const next: FillTheGapsGapDraft = { id, answers: [...existing.answers] };
      if (existing.distractors !== undefined && existing.distractors.length > 0) {
        next.distractors = [...existing.distractors];
      }
      return next;
    }
    return { id, answers: [FILL_THE_GAPS_GAP_STARTER_ANSWER] };
  });
}

/**
 * When a surface commits a fill-the-gaps heading it may hand us the *display* text
 * (`J'____ raté le train.`), not the authored prompt (`J'{{g1}} raté le train.`).
 * Same contract as timer tokens: keep the source if the author did not change
 * what they see; otherwise rebuild `{{id}}` from the blanks (or answers) that
 * were drawn, in order. A rewrite that cannot carry every gap is refused — the
 * stored prompt wins — so a click-and-blur cannot wipe the placeholders.
 */
export function commitFillTheGapsPrompt(
  stored: string,
  committed: string,
  gaps: readonly { id: string; answers?: readonly string[] }[] = [],
): string {
  const trimmed = committed.trim();
  const blanked = fillTheGapsPromptText(stored);
  const filled = fillTheGapsPromptText(stored, gaps);
  if (trimmed === stored.trim() || trimmed === blanked.trim() || trimmed === filled.trim()) {
    return stored;
  }
  if (fillTheGapsGapIssue({ prompt: committed, gaps: gapsForFillTheGapsPrompt(committed, asDrafts(gaps)) }) === null) {
    return committed;
  }
  const fromBlanks = rebuildFillTheGapsPrompt(committed, stored, (id) => {
    void id;
    return '____';
  });
  if (fromBlanks !== null && fillTheGapsLegalPrompt(fromBlanks)) return fromBlanks;
  const fromAnswers = rebuildFillTheGapsPrompt(committed, stored, (id) => {
    const answer = gaps.find((gap) => gap.id === id)?.answers?.[0];
    return answer !== undefined && answer !== '' ? answer : '____';
  });
  if (fromAnswers !== null && fillTheGapsLegalPrompt(fromAnswers)) return fromAnswers;
  return stored;
}

function asDrafts(
  gaps: readonly { id: string; answers?: readonly string[]; distractors?: readonly string[] }[],
): FillTheGapsGapDraft[] {
  return gaps.map((gap) => {
    const next: FillTheGapsGapDraft = {
      id: gap.id,
      answers:
        gap.answers !== undefined && gap.answers.length > 0
          ? [...gap.answers]
          : [FILL_THE_GAPS_GAP_STARTER_ANSWER],
    };
    if (gap.distractors !== undefined && gap.distractors.length > 0) {
      next.distractors = [...gap.distractors];
    }
    return next;
  });
}

function fillTheGapsLegalPrompt(prompt: string): boolean {
  const placeholders = [...splitFillTheGapsPrompt(prompt)].filter((token) => token.kind === 'gap');
  const ids = fillTheGapsPlaceholderIds(prompt);
  return ids.length === placeholders.length && ids.length >= MIN_FILL_THE_GAPS_GAPS && ids.length <= MAX_FILL_THE_GAPS_GAPS;
}

/**
 * Walk `committed` left to right, replacing each gap's displayed span with
 * `{{id}}`. Fails when a displayed span is missing — the author rewrote the
 * sentence without leaving the blanks in place.
 */
function rebuildFillTheGapsPrompt(
  committed: string,
  stored: string,
  shownFor: (id: string) => string,
): string | null {
  let result = '';
  let cursor = 0;
  for (const token of splitFillTheGapsPrompt(stored)) {
    if (token.kind !== 'gap') continue;
    const shown = shownFor(token.id);
    if (shown === '') return null;
    const at = committed.indexOf(shown, cursor);
    if (at === -1) return null;
    result += committed.slice(cursor, at) + `{{${token.id}}}`;
    cursor = at + shown.length;
  }
  result += committed.slice(cursor);
  return result;
}

/** Enough of a fill-the-gaps interaction to grade one ballot against. */
export interface FillTheGapsGrading {
  gaps: readonly { id: string; answers?: readonly string[] }[];
  match?: TextMatchOptions;
}

export interface FillTheGapsGapGrade {
  id: string;
  /** The submitted text, normalized with the interaction's match policy. */
  answer: string;
  /** False whenever the gap carries no accepted answers (nothing to grade). */
  correct: boolean;
}

export interface FillTheGapsGrade {
  gaps: FillTheGapsGapGrade[];
  correctCount: number;
  total: number;
  allCorrect: boolean;
}

/**
 * Picker words for one gap: the first accepted answer plus its distractors,
 * de-duplicated and localeCompare-sorted so position never marks the key.
 */
export function fillTheGapsGapOptions(gap: {
  answers: readonly string[];
  distractors?: readonly string[];
}): string[] {
  const words: string[] = [];
  const primary = gap.answers[0];
  if (primary !== undefined && primary.trim() !== '') words.push(primary);
  for (const distractor of gap.distractors ?? []) {
    if (distractor.trim() !== '') words.push(distractor);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    unique.push(word);
  }
  return unique.sort((a, b) => a.localeCompare(b));
}

/**
 * Shared word-bank pool: every gap's first accepted answer ∪ `bank`,
 * de-duplicated with the interaction's match policy, then localeCompare-sorted.
 */
export function fillTheGapsBankWords(interaction: {
  gaps: readonly { answers: readonly string[] }[];
  bank?: readonly string[];
  match?: TextMatchOptions;
}): string[] {
  const words: string[] = [];
  for (const gap of interaction.gaps) {
    const primary = gap.answers[0];
    if (primary !== undefined && primary.trim() !== '') words.push(primary);
  }
  for (const word of interaction.bank ?? []) {
    if (word.trim() !== '') words.push(word);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of words) {
    const key = normalizeTextAnswer(word, interaction.match);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    unique.push(word);
  }
  return unique.sort((a, b) => a.localeCompare(b));
}

/**
 * Wrap `prompt.slice(start, end)` as the next `{{gN}}`. Refused when the range
 * is empty, out of bounds, or overlaps an existing placeholder.
 */
export function insertFillTheGapsRange(
  prompt: string,
  gaps: readonly FillTheGapsGapDraft[],
  start: number,
  end: number,
): { prompt: string; gaps: FillTheGapsGapDraft[] } | null {
  if (start < 0 || end > prompt.length || start >= end) return null;
  const selected = prompt.slice(start, end);
  if (selected.trim() === '') return null;
  const pattern = fillTheGapsPlaceholderPattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (start < to && end > from) return null;
  }
  const used = new Set(gaps.map((gap) => gap.id));
  let n = 1;
  while (used.has(`g${String(n)}`)) n += 1;
  const id = `g${String(n)}`;
  const nextPrompt = `${prompt.slice(0, start)}{{${id}}}${prompt.slice(end)}`;
  const nextGaps = gapsForFillTheGapsPrompt(nextPrompt, [
    ...gaps,
    { id, answers: [selected.trim()] },
  ]);
  if (fillTheGapsGapIssue({ prompt: nextPrompt, gaps: nextGaps }) !== null) return null;
  return { prompt: nextPrompt, gaps: nextGaps };
}

/** Restore a gap's first accepted answer into the sentence and drop the gap. */
export function removeFillTheGapsGap(
  prompt: string,
  gaps: readonly FillTheGapsGapDraft[],
  gapId: string,
): { prompt: string; gaps: FillTheGapsGapDraft[] } {
  const gap = gaps.find((entry) => entry.id === gapId);
  const restored = gap?.answers[0] !== undefined && gap.answers[0] !== '' ? gap.answers[0] : '';
  const nextPrompt = prompt.replace(`{{${gapId}}}`, restored);
  return {
    prompt: nextPrompt,
    gaps: gapsForFillTheGapsPrompt(
      nextPrompt,
      gaps.filter((entry) => entry.id !== gapId),
    ),
  };
}

/** Deterministic Fisher–Yates so every phone and the stage show the same order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const next = [...items];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = next.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

export function gradeFillTheGaps(
  interaction: FillTheGapsGrading,
  gaps: Record<string, string>,
): FillTheGapsGrade {
  const rows = interaction.gaps.map((gap) => {
    const raw = gaps[gap.id] ?? '';
    return {
      id: gap.id,
      answer: normalizeTextAnswer(raw, interaction.match),
      correct: textAnswerMatches(raw, gap.answers, interaction.match),
    };
  });
  const correctCount = rows.filter((row) => row.correct).length;
  return {
    gaps: rows,
    correctCount,
    total: rows.length,
    allCorrect: rows.length > 0 && correctCount === rows.length,
  };
}

export interface MatchPairGrade {
  leftId: string;
  /** The right item this ballot chose, or undefined when the left was skipped. */
  chosen: string | undefined;
  correct: boolean;
}

export interface MatchGrade {
  pairs: MatchPairGrade[];
  correctCount: number;
  total: number;
  allCorrect: boolean;
}

/** Grade one match ballot against the interaction's answer key. */
export function gradeMatch(
  correct: Record<string, string>,
  pairs: Record<string, string>,
): MatchGrade {
  const rows = Object.entries(correct).map(([leftId, rightId]) => {
    const chosen = pairs[leftId];
    return { leftId, chosen, correct: chosen !== undefined && chosen === rightId };
  });
  const correctCount = rows.filter((row) => row.correct).length;
  return {
    pairs: rows,
    correctCount,
    total: rows.length,
    allCorrect: rows.length > 0 && correctCount === rows.length,
  };
}
