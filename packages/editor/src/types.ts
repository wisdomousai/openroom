/**
 * Local mirrors of the shared contracts (docs/CONTRACTS.md), used by the
 * editor and the apps that host it. Keep in sync with CONTRACTS.md.
 */
import type { DictionaryEntry, Outline, PresentationPosition } from '@openroom/schema';
import type { InkColor, MarkShape } from '@openroom/sdk';

export type SessionStatus = 'lobby' | 'live' | 'ended';
export type InteractionStatus = 'pending' | 'open' | 'closed' | 'revealed';

export type ResultVisibility = 'hidden-until-close' | 'live';

export type SortBy = 'order' | 'votes' | 'label';
export type ColorMode = 'series' | 'mono';
export type Orientation = 'horizontal' | 'vertical';

export interface DisplayOptions {
  orientation?: Orientation;
  showPercent?: boolean;
  showCount?: boolean;
  sortBy?: SortBy;
  colorMode?: ColorMode;
  innerHole?: number;
  showMean?: boolean;
  showMedian?: boolean;
  showAvgRank?: boolean;
  binCount?: number;
  maxItems?: number;
  maxWords?: number;
  minWordLength?: number;
}

export interface SessionMeta {
  title: string;
  description?: string;
  locale?: string;
  source?: string;
}

export interface Pedagogy {
  objective?: string;
  explanation?: string;
  followUp?: string;
  durationSec?: number;
}

export interface BaseInteraction {
  responseMode?: 'individual' | 'group';
  id: string;
  type: InteractionType;
  prompt: string;
  display?: string;
  displayOptions?: DisplayOptions;
  resultVisibility?: ResultVisibility;
  allowAnswerChange?: boolean;
  allowDontKnow?: boolean;
  notes?: string;
  pedagogy?: Pedagogy;
  /**
   * Optional live countdown (seconds). When set, the session auto-closes the
   * interaction at expiry. Distinct from pedagogy.durationSec.
   */
  timerSec?: number;
}

export type InteractionType =
  | 'choice'
  | 'scale'
  | 'numeric'
  | 'text'
  | 'qna'
  | 'ranking'
  | 'fill-the-gaps'
  | 'match';

export interface ChoiceOption {
  id: string;
  label: string;
  correct?: boolean;
  misconception?: string;
}

export interface ChoiceInteraction extends BaseInteraction {
  type: 'choice';
  options: ChoiceOption[];
  multiple?: boolean;
  /** Vote → discuss → revote (docs/CONTRACTS.md §Domain). */
  peerInstruction?: boolean;
}
export interface ScaleInteraction extends BaseInteraction {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}
export interface NumericInteraction extends BaseInteraction {
  type: 'numeric';
  unit?: string;
  correct?: number;
  tolerance?: number;
}
export interface TextInteraction extends BaseInteraction {
  type: 'text';
  maxLength?: number;
  /** Accepted short answers for quiz reveal (trim + case-insensitive). */
  correctAnswers?: string[];
}
export interface QnaInteraction extends BaseInteraction {
  type: 'qna';
}
export interface RankingInteraction extends BaseInteraction {
  type: 'ranking';
  options: { id: string; label: string }[];
  /** Optional correct permutation of option ids (best first). */
  correctOrder?: string[];
}
export interface FillTheGapsInteraction extends BaseInteraction {
  type: 'fill-the-gaps';
  display?: 'gaps' | 'bank' | 'choices';
  gaps: { id: string; answers: string[]; distractors?: string[] }[];
  bank?: string[];
  match?: { locale?: string; accents?: 'require' | 'ignore'; punctuation?: 'keep' | 'strip' };
}
export interface MatchInteraction extends BaseInteraction {
  type: 'match';
  left: { id: string; label: string }[];
  right: { id: string; label: string }[];
  correct: Record<string, string>;
}

export type Interaction =
  | ChoiceInteraction
  | ScaleInteraction
  | NumericInteraction
  | TextInteraction
  | QnaInteraction
  | RankingInteraction
  | FillTheGapsInteraction
  | MatchInteraction;

export interface Session {
  version: 1;
  meta: SessionMeta;
  defaults?: {
    // Mirrors `IdentityMode` in @openroom/schema; `identified` is the mode a
    // participant reaches by holding a context access link.
    identityMode?: 'anonymous' | 'pseudonymous' | 'identified';
    resultVisibility?: ResultVisibility;
    allowAnswerChange?: boolean;
    theme?: string;
  };
  /** Session-wide audience Q&A (ask + upvote), independent of interactions. */
  qna?: {
    enabled?: boolean;
    /** Max question length; default 300, hard cap 500. */
    maxLength?: number;
  };
  interactions: Interaction[];
}

export type Aggregate =
  | { kind: 'choice'; counts: Record<string, number>; total: number; dontKnow: number }
  | {
      kind: 'scale';
      counts: Record<number, number>;
      total: number;
      mean: number | null;
      dontKnow: number;
    }
  | {
      kind: 'numeric';
      values: number[];
      total: number;
      mean: number | null;
      median: number | null;
      dontKnow: number;
    }
  | { kind: 'text'; entries: TextEntry[]; total: number }
  | { kind: 'qna'; entries: QnaEntry[]; total: number }
  | {
      kind: 'ranking';
      scores: Record<string, number>;
      avgRank: Record<string, number | null>;
      total: number;
      dontKnow: number;
    }
  | {
      kind: 'fill-the-gaps';
      entries: { participantId: string; gaps: Record<string, string>; hidden: boolean; handle?: string }[];
      total: number;
      dontKnow: number;
    }
  | {
      kind: 'match';
      pairs: Record<string, Record<string, number>>;
      entries: { participantId: string; pairs: Record<string, string>; handle?: string }[];
      total: number;
      dontKnow: number;
    };

export interface TextEntry {
  participantId: string;
  text: string;
  hidden: boolean;
}
export interface QnaEntry extends TextEntry {
  votes: number;
}

export interface HostInteractionRuntime {
  status: InteractionStatus;
  aggregate?: Aggregate;
  answered?: number;
  openedAt?: number;
  closedAt?: number;
  closesAt?: number;
  resultsHidden?: boolean;
  resultsVisible?: boolean;
  /** Peer instruction only. */
  round?: 1 | 2;
  round1Aggregate?: Aggregate;
}

/** Flat per-interaction summary (the shape @openroom/sdk declares). */
export interface HostInteractionSummary {
  id: string;
  type: InteractionType;
  prompt: string;
  status: InteractionStatus;
  answered: number;
  aggregate?: Aggregate;
  notes?: string;
  openedAt?: number;
  closedAt?: number;
  closesAt?: number;
  resultsHidden?: boolean;
  /** Whether participant/stage currently see aggregates for this interaction. */
  resultsVisible?: boolean;
  /** Peer instruction only; the host snapshot carries it with no reveal gate. */
  round?: 1 | 2;
  round1Aggregate?: Aggregate;
  /** Effective chart display (live override ?? authored). */
  display?: string;
}

/**
 * Host snapshot as produced by `hostSnapshot(state)`.
 *
 * Two shapes are tolerated because the contract and the SDK's declared type
 * disagree in detail: `interactions` may be an array of summaries (SDK) or a
 * record keyed by interaction id (domain SessionState), and the session
 * document may or may not be included. Everything is optional; see `snapshot.ts` for the accessors.
 */
// ---- Session-wide audience Q&A ---------------------------------------------

export type QnaStagePlacement =
  | { mode: 'off' }
  | { mode: 'list' }
  | { mode: 'spotlight'; questionId: string };

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
  /** Votes-descending, then oldest-first. */
  questions: HostQnaQuestion[];
}

export interface HostSnapshot {
  facilitation?: import('@openroom/sdk').FacilitationView;
  groups?: import('@openroom/sdk').SessionGroupView[];
  participants?: { id: string; label: string }[];
  responseNames?: Record<string, string>;
  revision: number;
  status: SessionStatus;
  /** Active theme id — one of the five built-ins (docs/CONTRACTS.md §UI theming). */
  theme?: string;
  sessionCode?: string;
  code?: string;
  joinUrl?: string;
  activeInteractionId?: string | null;
  interactions?: HostInteractionSummary[] | Record<string, HostInteractionRuntime>;
  /** Active interaction view + its aggregate (SDK shape). */
  interaction?: (Partial<Interaction> & { id: string; type: InteractionType; prompt: string }) | null;
  interactionStatus?: InteractionStatus | null;
  aggregate?: Aggregate | null;
  frozen: boolean;
  joined?: number;
  answered?: number;
  participantCount?: number;
  /** Most participants the session admits; absent when unlimited. */
  participantLimit?: number;
  answeredCount?: number;
  /** Absolute ms auto-close deadline for the active interaction, when armed. */
  closesAt?: number;
  /** participantId → session-local handle; present only in pseudonymous sessions. */
  handles?: Record<string, string>;
  listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean };
  marks?: Array<
    | { kind: 'circle'; partKey: string; token: number }
    | { kind: 'pen'; points: { x: number; y: number }[] }
  >;
  meaning?: { partKey: string; token: number; text: string; shown: boolean };
  dictionary?: { id: string; partKey: string; token: number; entry: DictionaryEntry };
  /** Session-wide audience Q&A; absent on workers that predate it. */
  qna?: HostQnaView;
  /** Full outline is host-only; learner/stage snapshots contain only the current safe step. */
  outline?: { outlineVersion: number; currentStepIndex: number; shownGroups?: number; content: Outline };
  clock?: {
    stepId: string;
    authoredSec: number;
    remainingSecAt: number;
    remainingSec: number;
    running: boolean;
    placement: 'slide' | 'corner';
  };
  endedAt?: number;
}

// ---- Commands (host subset) -------------------------------------------------

export type HostCommand =
  | { command: 'presentation.handoff'; facilitatorId: string }
  | { command: 'presentation.recover' }
  | { command: 'group.set'; group: import('@openroom/sdk').SessionGroupView }
  | { command: 'group.remove'; groupId: string }
  | { command: 'session.start'; cursor?: PresentationPosition }
  | { command: 'session.end' }
  | { command: 'session.freeze' }
  | { command: 'session.unfreeze' }
  | { command: 'session.advance' }
  | { command: 'outline.goto'; stepId: string }
  | { command: 'outline.next' }
  | { command: 'outline.previous' }
  | {
      command: 'mark.set';
      mark:
        | { kind: MarkShape; partKey: string; token: number; endToken?: number; color?: InkColor }
        | { kind: 'pen'; points: { x: number; y: number }[]; color?: InkColor };
    }
  /** Rub out one mark by id; unknown ids are a silent success. */
  | { command: 'mark.remove'; id: string }
  | { command: 'mark.clear' }
  /** Publish the chosen meaning and forms together on the current slide. Drafts stay local. */
  | { command: 'meaning.publish'; stepId: string; partKey: string; token: number; word: string; text?: string; entry?: DictionaryEntry }
  | { command: 'meaning.clear'; stepId: string; partKey: string; token: number }
  | { command: 'listening.set'; stepId: string; mode?: 'room' | 'individual'; transcriptShown?: boolean }
  | {
      command: 'outline.insert';
      step: Outline['steps'][number];
      afterStepId?: string;
      show?: boolean;
      interaction?: import('@openroom/schema').Interaction;
    }
  | {
      command: 'outline.replace';
      stepId: string;
      step: Outline['steps'][number];
    }
  | { command: 'interaction.open'; interactionId: string }
  | { command: 'interaction.close'; interactionId: string }
  | { command: 'interaction.reveal'; interactionId: string }
  | { command: 'interaction.hideResults'; interactionId: string }
  | { command: 'interaction.showResults'; interactionId: string }
  | { command: 'interaction.revote'; interactionId: string }
  | { command: 'interaction.undoRevote'; interactionId: string }
  | { command: 'session.theme'; theme: string }
  | { command: 'session.display'; display: string }
  | { command: 'timer.start' }
  | { command: 'timer.pause' }
  | { command: 'timer.reset' }
  | { command: 'timer.adjust'; seconds: number }
  | { command: 'text.hide'; interactionId: string; participantId: string }
  | { command: 'text.unhide'; interactionId: string; participantId: string }
  | { command: 'qna.hide'; questionId: string }
  | { command: 'qna.unhide'; questionId: string }
  | { command: 'qna.stage'; mode: 'off' | 'list' | 'spotlight'; questionId?: string };

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline';

// ---- Server errors ----------------------------------------------------------

export interface SessionError {
  code: string;
  path: string;
  message: string;
}

export interface ApiErrorBody {
  ok?: false;
  error?: { code?: string; message?: string } | string;
  errors?: SessionError[];
  code?: string;
  message?: string;
}

// ---- Local persistence ------------------------------------------------------

export interface StoredSession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  title?: string;
  joinUrl?: string;
  /**
   * Local copy of the outline as submitted, so the console can show option
   * labels and host notes if a snapshot is thin.
   */
  outline?: Outline;
  createdAt: number;
}
