/**
 * Ballot deletion (PRD DATA-04).
 *
 * A finished session keeps its teaching value — the aggregates — long after the
 * per-person answers stop being anyone's business. `deleteBallots` is the pure
 * half of that story: it drops every ballot and every participant record while
 * leaving the stored aggregates intact, so counts, means and the wording of
 * text/Q&A entries survive while the link back to a person does not.
 *
 * The worker calls this from an alarm 30 minutes after a session ends; full session
 * deletion follows 24 hours after the end.
 */

import { ensureQna, sortedQuestions } from './qna.js';
import type { Aggregate, InteractionRuntime, QnaQuestion, QnaState, SessionState } from './types.js';

/**
 * Replace every participantId in a text/Q&A aggregate with a stable ordinal
 * placeholder. Ordinals follow the stored entry order, which is itself stable
 * (aggregates are recomputed deterministically from the ballot map), so two
 * deletes of the same state produce the same labels.
 */
function anonymizeAggregate(aggregate: Aggregate): Aggregate {
  if (aggregate.kind === 'text') {
    return {
      kind: 'text',
      entries: aggregate.entries.map((entry, index) => ({
        participantId: `deleted-${String(index + 1)}`,
        text: entry.text,
        hidden: entry.hidden,
      })),
      total: aggregate.total,
    };
  }
  if (aggregate.kind === 'qna') {
    return {
      kind: 'qna',
      entries: aggregate.entries.map((entry, index) => ({
        participantId: `deleted-${String(index + 1)}`,
        text: entry.text,
        hidden: entry.hidden,
        votes: entry.votes,
      })),
      total: aggregate.total,
    };
  }
  if (aggregate.kind === 'fill-the-gaps') {
    return {
      ...aggregate,
      entries: aggregate.entries.map((entry, index) => ({
        participantId: `deleted-${String(index + 1)}`,
        gaps: entry.gaps,
        hidden: entry.hidden,
      })),
    };
  }
  if (aggregate.kind === 'match') {
    return {
      ...aggregate,
      entries: aggregate.entries.map((entry, index) => ({
        participantId: `deleted-${String(index + 1)}`,
        pairs: entry.pairs,
      })),
    };
  }
  return aggregate;
}

function deleteRuntimeBallots(runtime: InteractionRuntime): InteractionRuntime {
  const deleted: InteractionRuntime = {
    ...runtime,
    ballots: {},
    aggregate: anonymizeAggregate(runtime.aggregate),
  };
  delete deleted.groupNames;
  // Peer instruction keeps a round-1 archive; its ballots are per-person data
  // and go the same way, while the round-1 aggregate survives anonymized.
  if (runtime.round1 !== undefined) {
    deleted.round1 = { ballots: {}, aggregate: anonymizeAggregate(runtime.round1.aggregate) };
  }
  return deleted;
}

/**
 * Session Q&A goes the same way as text/Q&A aggregates: the questions (text,
 * hidden flag, vote count, timestamp) keep their teaching value, the voter
 * ledgers and asker identities do not. Ordinals follow the deterministic
 * display order so two deletes of the same state produce the same labels.
 */
function anonymizeQna(qna: QnaState): QnaState {
  const questions: Record<string, QnaQuestion> = {};
  sortedQuestions(qna).forEach((question, index) => {
    questions[question.id] = {
      ...question,
      participantId: `deleted-${String(index + 1)}`,
      voters: [],
    };
  });
  return { ...qna, questions };
}

/**
 * Drop the per-person layer of a finished session, keeping the aggregates.
 *
 * Pure and total, like `applyCommand`:
 *  - a session that is not `ended` is returned unchanged. The deletion is
 *    time-triggered by an alarm, never a live-session operation, so there is no
 *    race to lose here: refusing is strictly safer than racing a session that is
 *    still collecting answers.
 *  - a session that already carries `ballotsDeletedAt` is returned unchanged (idempotent —
 *    an alarm may legitimately fire twice).
 *  - otherwise: every ballot map is emptied (peer-instruction round-1 archives
 *    included), text/Q&A aggregate entries keep
 *    their text/hidden/votes with `participantId` replaced by `deleted-<n>`,
 *    `participants` is emptied, `ballotsDeletedAt` is stamped and `revision` bumps once.
 */
export function deleteBallots(input: SessionState, now: number): SessionState {
  const state = ensureQna(input);
  if (state.status !== 'ended') return input;
  if (state.ballotsDeletedAt !== undefined) return input;

  const interactions: Record<string, InteractionRuntime> = {};
  for (const [id, runtime] of Object.entries(state.interactions)) {
    interactions[id] = deleteRuntimeBallots(runtime);
  }

  return {
    ...state,
    revision: state.revision + 1,
    interactions,
    qna: anonymizeQna(state.qna),
    participants: {},
    groups: {},
    hosting: { presenterId: '', hosts: {} },
    ballotsDeletedAt: now,
  };
}
