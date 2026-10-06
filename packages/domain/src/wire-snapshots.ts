/**
 * Domain snapshots → SDK wire snapshots.
 *
 * `packages/domain/src/snapshots.ts` and `packages/sdk/src/types.ts` disagree on
 * a handful of field names. Per the integration contract the SDK types win, so
 * every rename lives here in one place:
 *
 *   participant: yourAnswer → ownAnswer, results → aggregate
 *   stage:       joinPath   → joinUrl
 *   host:        joinPath   → joinUrl, plus `interaction`/`interactionStatus`/
 *                `aggregate` for the ACTIVE interaction (domain's hostSnapshot
 *                only carries the per-interaction summary list).
 *                `interactions[]` is narrowed to { id, type, prompt, status,
 *                answered, aggregate, … } — openedAt/closedAt/closesAt are kept
 *                when present so the host console can show the countdown; the
 *                SDK HostInteractionSummary now declares them. `aggregate` is
 *                kept as an additive field because `openroom results` needs the
 *                aggregate of every interaction, not only the active one.
 *
 * Reveal gating: the domain strips `correct` / `misconception` / `tolerance` /
 * `correctAnswers` / `correctOrder` from every interaction view unconditionally
 * (schema `participantView`). The SDK type says those fields appear once
 * revealed, and the stage needs them to highlight the right answer, so
 * `interactionView()` merges them back from the outline when the interaction
 * status is `revealed`.
 */

import {
  effectiveDisplay,
  hostSnapshot as domainHostSnapshot,
  participantSnapshot as domainParticipantSnapshot,
  stageSnapshot as domainStageSnapshot,
} from './snapshots.js';
import { sessionOf } from './create-session.js';
import type { SessionState } from './types.js';
import { fillTheGapsBankWords, fillTheGapsGapOptions } from '@openroom/schema';

export type Json = Record<string, unknown>;

/** An interaction as sent to participant/stage/host, post-reveal fields merged in. */
export function interactionView(state: SessionState, interactionId: string | null): Json | null {
  if (interactionId === null) return null;
  const planned = sessionOf(state).interactions.find((candidate) => candidate.id === interactionId);
  if (planned === undefined) return null;

  const runtime = state.interactions[interactionId];
  const revealed = runtime?.status === 'revealed';

  // Start from the safe projection (drops notes/correct/misconception/tolerance/
  // correctAnswers/correctOrder).
  const { notes: _notes, pedagogy: _pedagogy, ...rest } = planned as typeof planned & { notes?: string };
  const view: Json = { ...(rest as unknown as Json) };

  if (planned.type === 'choice') {
    view.options = planned.options.map((option) => {
      const projected: Json = { id: option.id, label: option.label };
      if (revealed) {
        if (option.correct !== undefined) projected.correct = option.correct;
        if (option.misconception !== undefined) projected.misconception = option.misconception;
      }
      return projected;
    });
  } else if (planned.type === 'numeric') {
    delete view.correct;
    delete view.tolerance;
    if (revealed) {
      if (planned.correct !== undefined) view.correct = planned.correct;
      if (planned.tolerance !== undefined) view.tolerance = planned.tolerance;
    }
  } else if (planned.type === 'text') {
    delete view.correctAnswers;
    if (revealed && planned.correctAnswers !== undefined) {
      view.correctAnswers = [...planned.correctAnswers];
    }
  } else if (planned.type === 'ranking') {
    delete view.correctOrder;
    view.options = planned.options.map((option) => ({ id: option.id, label: option.label }));
    if (revealed && planned.correctOrder !== undefined) {
      view.correctOrder = [...planned.correctOrder];
    }
  } else if (planned.type === 'fill-the-gaps') {
    delete view.bank;
    const bankWords = fillTheGapsBankWords(planned);
    if (bankWords.length >= 2) view.bankWords = bankWords;
    else delete view.bankWords;
    view.gaps = planned.gaps.map((gap) => {
      const projected: Json = { id: gap.id };
      const options = fillTheGapsGapOptions(gap);
      if (options.length >= 2) projected.options = options;
      if (revealed) projected.answers = [...gap.answers];
      return projected;
    });
  } else if (planned.type === 'match') {
    delete view.correct;
    if (revealed) view.correct = { ...planned.correct };
  }

  const display = effectiveDisplay(state, interactionId);
  if (display !== undefined) view.display = display;

  return view;
}

export function participantWireSnapshot(state: SessionState, participantId: string): Json {
  const snapshot = domainParticipantSnapshot(state, participantId);
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    frozen: snapshot.frozen,
    theme: snapshot.theme,
    interaction: interactionView(state, state.activeInteractionId),
    interactionStatus: snapshot.interactionStatus,
    answered: snapshot.answered,
    ownAnswer: snapshot.yourAnswer,
    yourLabel: snapshot.yourLabel,
    ...(snapshot.yourGroup ? { yourGroup: snapshot.yourGroup } : {}),
    aggregate: snapshot.results,
    ...(snapshot.closesAt === undefined ? {} : { closesAt: snapshot.closesAt }),
    // Peer instruction (Feature B): straight copies — domain and SDK agree on
    // these names, so no rename is needed.
    ...(snapshot.round === undefined ? {} : { round: snapshot.round }),
    ...(snapshot.round1Aggregate === undefined ? {} : { round1Aggregate: snapshot.round1Aggregate }),
    ...(snapshot.ownRound1Answer === undefined ? {} : { ownRound1Answer: snapshot.ownRound1Answer }),
    ...(snapshot.yourHandle === undefined ? {} : { yourHandle: snapshot.yourHandle }),
    // Session Q&A: domain and SDK agree on the shape, straight copy.
    ...(snapshot.qna === undefined ? {} : { qna: snapshot.qna }),
    ...(snapshot.outline === undefined ? {} : { outline: snapshot.outline }),
    ...(snapshot.marks === undefined ? {} : { marks: snapshot.marks }),
    ...(snapshot.meaning === undefined ? {} : { meaning: snapshot.meaning }),
    ...(snapshot.dictionary === undefined ? {} : { dictionary: snapshot.dictionary }),
    ...(snapshot.clock === undefined ? {} : { clock: snapshot.clock }),
    ...(snapshot.listening === undefined ? {} : { listening: snapshot.listening }),
    /*
     * Which identity regime this session runs under. Not sensitive (the join
     * response already tells the same client), and the tutoring learner surface
     * needs it: `identified` is what makes a session a tutoring session rather than a
     * class, and it is derived from the launch chain, never from a toggle.
     */
    identityMode: sessionOf(state).defaults.identityMode,
    // extras (not in the SDK type, harmless additive fields)
    participantId: snapshot.participantId,
    ...(snapshot.endedAt === undefined ? {} : { endedAt: snapshot.endedAt }),
  };
}

export function stageWireSnapshot(state: SessionState): Json {
  const snapshot = domainStageSnapshot(state);
  return {
    role: 'stage',
    revision: snapshot.revision,
    status: snapshot.status,
    theme: snapshot.theme,
    code: snapshot.code,
    joinUrl: snapshot.joinPath,
    frozen: snapshot.frozen,
    participantCount: snapshot.participantCount,
    expectedAnswerCount: snapshot.expectedAnswerCount,
    answeredCount: snapshot.answeredCount,
    interaction: interactionView(state, state.activeInteractionId),
    interactionStatus: snapshot.interactionStatus,
    aggregate: snapshot.aggregate,
    ...(snapshot.closesAt === undefined ? {} : { closesAt: snapshot.closesAt }),
    ...(snapshot.round === undefined ? {} : { round: snapshot.round }),
    ...(snapshot.round1Aggregate === undefined ? {} : { round1Aggregate: snapshot.round1Aggregate }),
    title: snapshot.title,
    ...(snapshot.qna === undefined ? {} : { qna: snapshot.qna }),
    ...(snapshot.outline === undefined ? {} : { outline: snapshot.outline }),
    ...(snapshot.marks === undefined ? {} : { marks: snapshot.marks }),
    ...(snapshot.meaning === undefined ? {} : { meaning: snapshot.meaning }),
    ...(snapshot.dictionary === undefined ? {} : { dictionary: snapshot.dictionary }),
    ...(snapshot.clock === undefined ? {} : { clock: snapshot.clock }),
    ...(snapshot.listening === undefined ? {} : { listening: snapshot.listening }),
    ...(snapshot.endedAt === undefined ? {} : { endedAt: snapshot.endedAt }),
  };
}

export function hostWireSnapshot(state: SessionState): Json {
  const snapshot = domainHostSnapshot(state);
  const activeId = state.activeInteractionId;
  const activeRuntime = activeId === null ? undefined : state.interactions[activeId];
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    theme: snapshot.theme,
    code: snapshot.code,
    joinUrl: snapshot.joinPath,
    frozen: snapshot.frozen,
    participantCount: snapshot.participantCount,
    expectedAnswerCount: snapshot.expectedAnswerCount,
    groups: snapshot.groups,
    participants: snapshot.participants,
    responseNames: snapshot.responseNames,
    answeredCount: snapshot.answeredCount,
    activeInteractionId: snapshot.activeInteractionId,
    interactions: snapshot.interactions.map((summary) => ({
      id: summary.id,
      type: summary.type,
      prompt: summary.prompt,
      status: summary.status,
      answered: summary.answered,
      resultsVisible: summary.resultsVisible,
      ...(summary.resultsHidden === true ? { resultsHidden: true } : {}),
      ...(summary.openedAt === undefined ? {} : { openedAt: summary.openedAt }),
      ...(summary.closedAt === undefined ? {} : { closedAt: summary.closedAt }),
      ...(summary.closesAt === undefined ? {} : { closesAt: summary.closesAt }),
      // Additive beyond the SDK type: `openroom results` renders every
      // interaction's aggregate, not just the active one, and the participantId
      // in text/qna entries is the argument `openroom session hide` needs.
      aggregate: summary.aggregate,
      ...(summary.round === undefined ? {} : { round: summary.round }),
      ...(summary.round1Aggregate === undefined ? {} : { round1Aggregate: summary.round1Aggregate }),
      ...(summary.display === undefined ? {} : { display: summary.display }),
    })),
    interaction: interactionView(state, activeId),
    interactionStatus: activeRuntime?.status ?? null,
    ...(activeRuntime?.status === 'open' && activeRuntime.closesAt !== undefined
      ? { closesAt: activeRuntime.closesAt }
      : {}),
    // The host always sees results, pre-reveal included (CONTRACTS §Snapshot views).
    aggregate: activeRuntime?.aggregate ?? null,
    ...(activeRuntime?.round === undefined ? {} : { round: activeRuntime.round }),
    ...(activeRuntime?.round1 === undefined ? {} : { round1Aggregate: activeRuntime.round1.aggregate }),
    sessionCode: snapshot.code,
    outline: snapshot.outline,
    ballots: snapshot.ballots,
    qna: snapshot.qna,
    ...(snapshot.outline === undefined ? {} : { outline: snapshot.outline }),
    ...(snapshot.marks === undefined ? {} : { marks: snapshot.marks }),
    ...(snapshot.meaning === undefined ? {} : { meaning: snapshot.meaning }),
    ...(snapshot.dictionary === undefined ? {} : { dictionary: snapshot.dictionary }),
    ...(snapshot.clock === undefined ? {} : { clock: snapshot.clock }),
    ...(snapshot.listening === undefined ? {} : { listening: snapshot.listening }),
    ...(snapshot.handles === undefined ? {} : { handles: snapshot.handles }),
    ...(snapshot.endedAt === undefined ? {} : { endedAt: snapshot.endedAt }),
    ...(snapshot.purgedAt === undefined ? {} : { purgedAt: snapshot.purgedAt }),
  };
}
