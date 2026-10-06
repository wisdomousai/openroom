import {
  resolveRevealOrder,
  participantView,
  projectOutlineStep,
  resolveSlideDesign,
  type Display,
  type OutlineStep,
  type ParticipantInteraction,
} from '@openroom/schema';

import { expectedAnswerCount, groupBallotKey, participantGroup, participantLabel } from './groups.js';
import { listeningFor } from './listening.js';
import { isPollOnlyOutline, sessionOf } from './create-session.js';
import { ensureQna, qnaMaxLength, sortedQuestions } from './qna.js';

import type {
  Aggregate,
  Ballot,
  InteractionStatus,
  QnaStagePlacement,
  LearnerOutlineView,
  SessionClock,
  SessionState,
  SessionStatus,
} from './types.js';

/** Authored display, or the live `session.display` override if one is set. */
export function effectiveDisplay(state: SessionState, interactionId: string): Display | undefined {
  const runtime = state.interactions[interactionId];
  const authored = sessionOf(state).interactions.find((row) => row.id === interactionId)?.display;
  return runtime?.displayOverride ?? authored;
}

function interactionWithDisplay(
  state: SessionState,
  interactionId: string | null,
): ParticipantInteraction | null {
  if (interactionId === null) return null;
  const view = participantView(sessionOf(state), interactionId);
  if (view === null) return null;
  const display = effectiveDisplay(state, interactionId);
  if (display === undefined || display === view.display) return view;
  return { ...view, display } as ParticipantInteraction;
}

function learnerOutlineView(
  state: SessionState,
  participantId?: string,
): LearnerOutlineView | undefined {
  const outline = state.outline;
  if (outline === undefined) return undefined;
  const step = outline.content.steps[outline.currentStepIndex];
  if (step === undefined) return undefined;
  const lane = participantId === undefined ? undefined : state.participants[participantId]?.lane;
  return {
    outlineVersion: outline.outlineVersion,
    design: resolveSlideDesign(outline.content.design, step.design),
    currentStepIndex: outline.currentStepIndex,
    stepCount: outline.content.steps.length,
    currentStep: projectOutlineStep(filterStepForLane(step, lane), listeningFor(state)),
    ...(outline.shownGroups === undefined ? {} : {
      shownGroups: outline.shownGroups,
      hiddenParts: resolveRevealOrder(step, outline.content.interactions).slice(outline.shownGroups).flat(),
    }),
    ...(lane === undefined ? {} : { yourLane: lane }),
  };
}

function filterStepForLane(step: OutlineStep, lane: 0 | 1 | undefined): OutlineStep {
  if (lane === undefined) return step;
  if (step.kind === 'cards') {
    const items = step.items.filter((item) => item.lane === undefined || item.lane === lane);
    return items.length === step.items.length ? step : { ...step, items };
  }
  return step;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * May results be shown right now?
 *
 * Default is live: open/closed interactions with `resultVisibility === 'live'`
 * show aggregates as answers arrive. `hidden-until-close` stays blank until
 * the host reveals. Either way, `resultsHidden` blanks the audience/stage
 * without deleting ballots (host Hide results control).
 */
export function resultsVisible(state: SessionState, interactionId: string): boolean {
  const runtime = state.interactions[interactionId];
  const interaction = sessionOf(state).interactions.find((candidate) => candidate.id === interactionId);
  if (runtime === undefined || interaction === undefined) return false;
  if (runtime.resultsHidden === true) return false;
  if (runtime.status === 'revealed') return true;
  // Discussion between peer-instruction votes must not anchor the room to round one.
  if (interaction.type === 'choice' && interaction.peerInstruction && runtime.status === 'closed' && runtime.round === 1) return false;
  // Tutoring outlines (not a compiled poll list): after Close, named answers may
  // appear without scoring keys. Classroom hidden-until-close stays blank.
  if (!isPollOnlyOutline(state.outline) && runtime.status === 'closed') return true;
  return (
    interaction.resultVisibility === 'live' &&
    (runtime.status === 'open' || runtime.status === 'closed')
  );
}

/** A ballot as the owning participant sees it: no voter list at all. */
export type OwnAnswer =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'scale'; value: number }
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; text: string; hidden: boolean }
  | { kind: 'qna'; text: string; hidden: boolean; votes: number }
  | { kind: 'ranking'; optionIds: string[] }
  | { kind: 'fill-the-gaps'; gaps: Record<string, string> }
  | { kind: 'match'; pairs: Record<string, string> }
  | { kind: 'dont-know' };

function ownAnswer(ballot: Ballot): OwnAnswer {
  if (ballot.kind === 'qna') {
    return { kind: 'qna', text: ballot.text, hidden: ballot.hidden, votes: ballot.votes };
  }
  if (ballot.kind === 'fill-the-gaps') {
    return { kind: 'fill-the-gaps', gaps: { ...ballot.gaps } };
  }
  return ballot;
}

/**
 * Remove hidden text/Q&A entries. When the session is frozen, all participant text
 * disappears from public views entirely (panic button).
 */
function publicAggregate(
  aggregate: Aggregate,
  frozen: boolean,
  handles?: Record<string, string>,
): Aggregate {
  if (aggregate.kind === 'text') {
    const entries = frozen
      ? []
      : aggregate.entries
          .filter((entry) => !entry.hidden)
          .map((entry) => {
            const handle = handles?.[entry.participantId];
            return handle === undefined ? entry : { ...entry, handle };
          });
    return { kind: 'text', entries, total: aggregate.total };
  }
  if (aggregate.kind === 'fill-the-gaps') {
    const entries = frozen
      ? []
      : aggregate.entries
          .filter((entry) => !entry.hidden)
          .map((entry) => {
            const handle = handles?.[entry.participantId];
            return handle === undefined ? entry : { ...entry, handle };
          });
    return { ...aggregate, entries };
  }
  if (aggregate.kind === 'match') {
    const entries = frozen
      ? []
      : aggregate.entries.map((entry) => {
          const handle = handles?.[entry.participantId];
          return handle === undefined ? entry : { ...entry, handle };
        });
    return { ...aggregate, entries, pairs: frozen ? {} : aggregate.pairs };
  }
  if (aggregate.kind === 'qna') {
    const entries = frozen ? [] : aggregate.entries.filter((entry) => !entry.hidden);
    return { kind: 'qna', entries, total: aggregate.total };
  }
  return aggregate;
}

/**
 * Peer instruction anti-anchoring (Feature B): the round-1 aggregate is public
 * ONLY once the interaction is revealed. Before that, participants and the
 * stage get `null` — showing the first tally during the discussion is exactly
 * the anchoring the method exists to avoid. The host snapshot never uses this.
 *
 * Returns `undefined` when there is no round-1 archive at all, so the field can
 * be omitted entirely rather than advertising a peer-instruction interaction
 * that has not been revoted.
 */
function publicHandles(state: SessionState): Record<string, string> | undefined {
  const active = state.activeInteractionId;
  if (active && sessionOf(state).interactions.find((row) => row.id === active)?.responseMode === 'group') {
    return state.interactions[active]?.groupNames;
  }
  // Classroom poll lists do not publish handles on audience/stage aggregates.
  // Tutoring outlines may — the learner is named.
  if (isPollOnlyOutline(state.outline)) return undefined;
  const handles: Record<string, string> = {};
  for (const [id, record] of Object.entries(state.participants)) {
    if (record.handle !== undefined) handles[id] = record.handle;
  }
  return Object.keys(handles).length > 0 ? handles : undefined;
}

function publicRound1Aggregate(
  state: SessionState,
  interactionId: string,
): Aggregate | null | undefined {
  const runtime = state.interactions[interactionId];
  if (runtime === undefined || runtime.round1 === undefined) return undefined;
  if (runtime.status !== 'revealed') return null;
  return publicAggregate(runtime.round1.aggregate, state.frozen, publicHandles(state));
}

function answeredCount(state: SessionState, interactionId: string | null): number {
  if (interactionId === null) return 0;
  const runtime = state.interactions[interactionId];
  if (runtime === undefined) return 0;
  return Object.keys(runtime.ballots).length;
}

/* ------------------------------------------------------------------ */
/* Session Q&A projections                                             */
/* ------------------------------------------------------------------ */

/** A session Q&A question as a participant sees it. No voter list, ever. */
export interface ParticipantQnaQuestion {
  id: string;
  text: string;
  votes: number;
  own: boolean;
  votedByYou: boolean;
  /** only ever true on the participant's OWN moderated question */
  hidden: boolean;
  /** asker's session-local handle (pseudonymous sessions only) — system-assigned, not PII */
  handle?: string;
}

export interface ParticipantQnaView {
  maxLength: number;
  questions: ParticipantQnaQuestion[];
}

export interface StageQnaView {
  stage: QnaStagePlacement;
  questions: { id: string; text: string; votes: number; handle?: string }[];
}

export interface HostQnaQuestion {
  id: string;
  participantId: string;
  text: string;
  hidden: boolean;
  votes: number;
  createdAt: number;
}

export interface HostQnaView {
  enabled: boolean;
  stage: QnaStagePlacement;
  questions: HostQnaQuestion[];
}

/**
 * Visible questions plus the participant's own hidden ones (a moderated author
 * still sees their question, flagged, like hidden text answers). Frozen is the
 * panic button: all participant text disappears from public views.
 */
function participantQnaView(state: SessionState, participantId: string): ParticipantQnaView {
  const questions: ParticipantQnaQuestion[] = state.frozen
    ? []
    : sortedQuestions(state.qna)
        .filter((question) => !question.hidden || question.participantId === participantId)
        .map((question) => {
          const handle = state.participants[question.participantId]?.handle;
          return {
            id: question.id,
            text: question.text,
            votes: question.votes,
            own: question.participantId === participantId,
            votedByYou: question.voters.includes(participantId),
            hidden: question.hidden,
            ...(handle === undefined ? {} : { handle }),
          };
        });
  return { maxLength: qnaMaxLength(state), questions };
}

function stageQnaView(state: SessionState): StageQnaView {
  const questions = state.frozen
    ? []
    : sortedQuestions(state.qna)
        .filter((question) => !question.hidden)
        .map((question) => {
          const handle = state.participants[question.participantId]?.handle;
          return {
            id: question.id,
            text: question.text,
            votes: question.votes,
            ...(handle === undefined ? {} : { handle }),
          };
        });
  return { stage: state.qna.stage, questions };
}

function hostQnaView(state: SessionState): HostQnaView {
  return {
    enabled: state.qna.enabled,
    stage: state.qna.stage,
    questions: sortedQuestions(state.qna).map((question) => ({
      id: question.id,
      participantId: question.participantId,
      text: question.text,
      hidden: question.hidden,
      votes: question.votes,
      createdAt: question.createdAt,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Participant snapshot                                                */
/* ------------------------------------------------------------------ */

export interface ParticipantSnapshot {
  role: 'participant';
  revision: number;
  status: SessionStatus;
  frozen: boolean;
  /** active session theme id (one of SESSION_THEME_IDS); not sensitive */
  theme: string;
  participantId: string;
  interaction: ParticipantInteraction | null;
  interactionStatus: InteractionStatus | null;
  /** the participant's own current ballot, if any */
  yourAnswer: OwnAnswer | null;
  answered: boolean;
  /** null unless results are visible for the active interaction */
  results: Aggregate | null;
  /**
   * Absolute ms advisory window for the active interaction countdown.
   * Present only while open with a session `timerSec`. Zero never closes answering.
   */
  closesAt?: number;
  /** peer instruction round of the active interaction (absent when not a PI interaction) */
  round?: 1 | 2;
  /** round-1 tally: present once a revote happened, null until the reveal */
  round1Aggregate?: Aggregate | null;
  /** this participant's own round-1 ballot, so they can recall their first vote */
  ownRound1Answer?: OwnAnswer | null;
  /** own session-local handle (pseudonymous sessions only); peers' handles are never sent */
  yourHandle?: string;
  yourLabel: string;
  yourGroup?: { id: string; name: string; isSpokesperson: boolean };
  /** session-wide audience Q&A; present only when the session enables it */
  qna?: ParticipantQnaView;
  /** Current automatically-laid-out outline step; tutor notes are stripped. */
  outline?: LearnerOutlineView;
  marks?: SessionState['marks'];
  listening?: SessionState['listening'];
  /** Published meaning only. Private drafts stay on the host. */
  meaning?: SessionState['meaning'];
  /** The projected forms table. Present only while it is on the wall. */
  dictionary?: SessionState['dictionary'];
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClock;
  endedAt?: number;
}

export function participantSnapshot(
  input: SessionState,
  participantId: string,
): ParticipantSnapshot {
  const state = ensureQna(input);
  const activeId = state.activeInteractionId;
  const runtime = activeId === null ? undefined : state.interactions[activeId];
  const group = participantGroup(state, participantId);
  const groupQuestion = interactionWithDisplay(state, activeId)?.responseMode === 'group';
  const ballotKey = groupQuestion ? (group ? groupBallotKey(group.id) : null) : participantId;
  const ballot = ballotKey ? runtime?.ballots[ballotKey] : undefined;
  const visible = activeId !== null && resultsVisible(state, activeId);

  const snapshot: ParticipantSnapshot = {
    role: 'participant',
    revision: state.revision,
    status: state.status,
    frozen: state.frozen,
    theme: state.theme,
    participantId,
    yourLabel: participantLabel(state, participantId),
    ...(group ? { yourGroup: { id: group.id, name: group.name, isSpokesperson: group.spokespersonId === participantId } } : {}),
    interaction: interactionWithDisplay(state, activeId),
    interactionStatus: runtime?.status ?? null,
    yourAnswer: ballot === undefined ? null : ownAnswer(ballot),
    answered: ballot !== undefined,
    results:
      visible && runtime !== undefined
        ? publicAggregate(runtime.aggregate, state.frozen, publicHandles(state))
        : null,
  };
  if (runtime?.round !== undefined) snapshot.round = runtime.round;
  if (activeId !== null) {
    const round1 = publicRound1Aggregate(state, activeId);
    if (round1 !== undefined) snapshot.round1Aggregate = round1;
    const ownRound1 = ballotKey ? runtime?.round1?.ballots[ballotKey] : undefined;
    if (runtime?.round1 !== undefined) {
      snapshot.ownRound1Answer = ownRound1 === undefined ? null : ownAnswer(ownRound1);
    }
  }
  if (runtime?.status === 'open' && runtime.closesAt !== undefined) {
    snapshot.closesAt = runtime.closesAt;
  }
  const handle = state.participants[participantId]?.handle;
  if (handle !== undefined) snapshot.yourHandle = handle;
  if (state.qna.enabled) snapshot.qna = participantQnaView(state, participantId);
  const outline = learnerOutlineView(state, participantId);
  if (outline !== undefined) snapshot.outline = outline;
  if (state.marks !== undefined && state.marks.length > 0) snapshot.marks = state.marks;
  if (state.meaning?.shown === true) snapshot.meaning = state.meaning;
  if (state.dictionary !== undefined) snapshot.dictionary = state.dictionary;
  if (state.clock !== undefined) snapshot.clock = state.clock;
  const listening = listeningFor(state);
  if (listening) snapshot.listening = listening;
  if (state.endedAt !== undefined) snapshot.endedAt = state.endedAt;
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Stage snapshot                                                      */
/* ------------------------------------------------------------------ */

export interface StageSnapshot {
  role: 'stage';
  revision: number;
  status: SessionStatus;
  frozen: boolean;
  /** active session theme id (one of SESSION_THEME_IDS) */
  theme: string;
  code: string;
  /** relative path a participant should open; the app prefixes the origin */
  joinPath: string;
  title: string;
  participantCount: number;
  expectedAnswerCount: number;
  answeredCount: number;
  interaction: ParticipantInteraction | null;
  interactionStatus: InteractionStatus | null;
  aggregate: Aggregate | null;
  /**
   * Absolute ms advisory window for the active interaction countdown.
   * Present only while open with a session `timerSec`. Zero never closes answering.
   */
  closesAt?: number;
  /** peer instruction round of the active interaction (absent when not a PI interaction) */
  round?: 1 | 2;
  /** round-1 tally: present once a revote happened, null until the reveal */
  round1Aggregate?: Aggregate | null;
  /** session-wide audience Q&A; present only when the session enables it */
  qna?: StageQnaView;
  /** Current automatically-laid-out outline step; tutor notes are stripped. */
  outline?: LearnerOutlineView;
  marks?: SessionState['marks'];
  listening?: SessionState['listening'];
  /** Published meaning only. Private drafts stay on the host. */
  meaning?: SessionState['meaning'];
  /** The projected forms table. Present only while it is on the wall. */
  dictionary?: SessionState['dictionary'];
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClock;
  endedAt?: number;
}

export function stageSnapshot(input: SessionState): StageSnapshot {
  const state = ensureQna(input);
  const activeId = state.activeInteractionId;
  const runtime = activeId === null ? undefined : state.interactions[activeId];
  const visible = activeId !== null && resultsVisible(state, activeId);

  const snapshot: StageSnapshot = {
    role: 'stage',
    revision: state.revision,
    status: state.status,
    frozen: state.frozen,
    theme: state.theme,
    code: state.code,
    joinPath: `/?code=${state.code}`,
    title: sessionOf(state).meta.title,
    participantCount: Object.keys(state.participants).length,
    expectedAnswerCount: expectedAnswerCount(state),
    answeredCount: answeredCount(state, activeId),
    interaction: interactionWithDisplay(state, activeId),
    interactionStatus: runtime?.status ?? null,
    aggregate:
      visible && runtime !== undefined
        ? publicAggregate(runtime.aggregate, state.frozen, publicHandles(state))
        : null,
  };
  if (runtime?.round !== undefined) snapshot.round = runtime.round;
  if (activeId !== null) {
    const round1 = publicRound1Aggregate(state, activeId);
    if (round1 !== undefined) snapshot.round1Aggregate = round1;
  }
  if (runtime?.status === 'open' && runtime.closesAt !== undefined) {
    snapshot.closesAt = runtime.closesAt;
  }
  if (state.qna.enabled) snapshot.qna = stageQnaView(state);
  const outline = learnerOutlineView(state);
  if (outline !== undefined) snapshot.outline = outline;
  if (state.marks !== undefined && state.marks.length > 0) snapshot.marks = state.marks;
  if (state.meaning?.shown === true) snapshot.meaning = state.meaning;
  if (state.dictionary !== undefined) snapshot.dictionary = state.dictionary;
  if (state.clock !== undefined) snapshot.clock = state.clock;
  const listening = listeningFor(state);
  if (listening) snapshot.listening = listening;
  if (state.endedAt !== undefined) snapshot.endedAt = state.endedAt;
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Host snapshot                                                       */
/* ------------------------------------------------------------------ */

export interface HostInteractionSummary {
  id: string;
  type: string;
  prompt: string;
  status: InteractionStatus;
  answered: number;
  aggregate: Aggregate;
  openedAt?: number;
  closedAt?: number;
  /** Absolute ms advisory window while this interaction is open with a timer. */
  closesAt?: number;
  /** true when the host blanked audience/stage results */
  resultsHidden?: boolean;
  /** whether participant/stage snapshots currently include this aggregate */
  resultsVisible: boolean;
  /** peer instruction round (absent when the interaction is not a PI cycle) */
  round?: 1 | 2;
  /** archived round-1 tally — the host sees it immediately, reveal or not */
  round1Aggregate?: Aggregate;
  /** Effective chart display (live override ?? authored). */
  display?: Display;
}

export interface HostSnapshot {
  groups: NonNullable<SessionState['groups']>[string][];
  participants: { id: string; label: string }[];
  responseNames?: Record<string, string>;
  role: 'host';
  revision: number;
  status: SessionStatus;
  frozen: boolean;
  /** active session theme id (one of SESSION_THEME_IDS) */
  theme: string;
  code: string;
  joinPath: string;
  activeInteractionId: string | null;
  participantCount: number;
  expectedAnswerCount: number;
  answeredCount: number;
  interactions: HostInteractionSummary[];
  /** ballots including hidden entries and Q&A voter ledgers */
  ballots: Record<string, Record<string, Ballot>>;
  /** session-wide audience Q&A: always present so the console can show the disabled state */
  qna: HostQnaView;
  /** Full outline, including tutor-only notes. */
  outline: SessionState['outline'];
  marks?: SessionState['marks'];
  listening?: SessionState['listening'];
  /** Both the published and the unpublished meaning: this is the tutor's own view. */
  meaning?: SessionState['meaning'];
  dictionary?: SessionState['dictionary'];
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClock;
  /** participantId -> session-local handle; present only in pseudonymous sessions */
  handles?: Record<string, string>;
  endedAt?: number;
  /** set once the ballots have been purged (PRD DATA-04); host-only */
  purgedAt?: number;
}

export function hostSnapshot(input: SessionState): HostSnapshot {
  const state = ensureQna(input);
  const interactions: HostInteractionSummary[] = sessionOf(state).interactions.map((interaction) => {
    const runtime = state.interactions[interaction.id];
    const summary: HostInteractionSummary = {
      id: interaction.id,
      type: interaction.type,
      prompt: interaction.prompt,
      status: runtime?.status ?? 'pending',
      answered: runtime === undefined ? 0 : Object.keys(runtime.ballots).length,
      aggregate: runtime?.aggregate ?? { kind: 'text', entries: [], total: 0 },
      resultsVisible: resultsVisible(state, interaction.id),
    };
    if (runtime?.openedAt !== undefined) summary.openedAt = runtime.openedAt;
    if (runtime?.closedAt !== undefined) summary.closedAt = runtime.closedAt;
    if (runtime?.closesAt !== undefined) summary.closesAt = runtime.closesAt;
    if (runtime?.resultsHidden === true) summary.resultsHidden = true;
    if (runtime?.round !== undefined) summary.round = runtime.round;
    if (runtime?.round1 !== undefined) summary.round1Aggregate = runtime.round1.aggregate;
    const display = effectiveDisplay(state, interaction.id);
    if (display !== undefined) summary.display = display;
    return summary;
  });

  const ballots: Record<string, Record<string, Ballot>> = {};
  for (const [id, runtime] of Object.entries(state.interactions)) {
    ballots[id] = runtime.ballots;
  }

  const snapshot: HostSnapshot = {
    role: 'host',
    groups: Object.values(state.groups ?? {}).filter((group) => !group.removed),
    participants: Object.keys(state.participants).map((id) => ({ id, label: participantLabel(state, id) })),
    ...(state.activeInteractionId ? { responseNames: state.interactions[state.activeInteractionId]?.groupNames } : {}),
    revision: state.revision,
    status: state.status,
    frozen: state.frozen,
    theme: state.theme,
    code: state.code,
    joinPath: `/?code=${state.code}`,
    activeInteractionId: state.activeInteractionId,
    participantCount: Object.keys(state.participants).length,
    expectedAnswerCount: expectedAnswerCount(state),
    answeredCount: answeredCount(state, state.activeInteractionId),
    interactions,
    ballots,
    qna: hostQnaView(state),
    outline: state.outline,
  };
  if (state.marks !== undefined && state.marks.length > 0) snapshot.marks = state.marks;
  if (state.meaning !== undefined) snapshot.meaning = state.meaning;
  if (state.dictionary !== undefined) snapshot.dictionary = state.dictionary;
  if (state.clock !== undefined) snapshot.clock = state.clock;
  const listening = listeningFor(state);
  if (listening) snapshot.listening = listening;
  const handles: Record<string, string> = {};
  for (const [id, record] of Object.entries(state.participants)) {
    if (record.handle !== undefined) handles[id] = record.handle;
  }
  if (Object.keys(handles).length > 0) snapshot.handles = handles;
  if (state.endedAt !== undefined) snapshot.endedAt = state.endedAt;
  if (state.purgedAt !== undefined) snapshot.purgedAt = state.purgedAt;
  return snapshot;
}
