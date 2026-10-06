/**
 * Session-wide audience Q&A helpers.
 *
 * The question map lives in `SessionState.qna`, outside the interaction runtimes,
 * because session Q&A is open for the whole session — it must survive
 * `interaction.open` / `session.advance` untouched and never appear as a
 * pending step in the host flow.
 */

import type { QnaQuestion, QnaState, SessionState } from './types.js';

/** Mirror of `DEFAULT_QNA_MAX_LENGTH` in @openroom/schema (domain stays schema-lean). */
export const QNA_DEFAULT_MAX_LENGTH = 300;
export const QNA_HARD_MAX_LENGTH = 500;
export const QNA_QUESTION_ID_MAX_LENGTH = 64;

export function emptyQnaState(enabled = false): QnaState {
  return { enabled, stage: { mode: 'off' }, questions: {} };
}

/**
 * Fills qna when a persisted session predates the region. Outline is always present.
 */
export function ensureQna(state: SessionState): SessionState {
  if (state.qna !== undefined) return state;
  return { ...state, qna: emptyQnaState(state.outline.content.qna?.enabled ?? false) };
}

/** Question length cap for this session; outlines stored before the field default to 300. */
export function qnaMaxLength(state: SessionState): number {
  return state.outline.content.qna?.maxLength ?? QNA_DEFAULT_MAX_LENGTH;
}

/**
 * Deterministic display order: most-voted first, then oldest first, then id.
 * Computed at snapshot time — question counts are small and this keeps the
 * stored state free of a derived aggregate.
 */
export function sortedQuestions(qna: QnaState): QnaQuestion[] {
  return Object.values(qna.questions).sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
}
