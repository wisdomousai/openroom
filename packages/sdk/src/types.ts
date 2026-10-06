/**
 * Types mirrored from docs/CONTRACTS.md.
 *
 * The SDK deliberately has ZERO runtime dependencies. Shared design types use
 * type-only imports from @openroom/schema; the shapes below are the wire
 * contract as documented, re-declared here so browser apps have one import.
 */

/* ------------------------------------------------------------------ session */

import type { InkColor, MarkShape } from './ink.js';
import type { PresentationPosition, ResolvedSlideDesign } from '@openroom/schema';

export type SessionStatus = 'lobby' | 'live' | 'ended';
export type InteractionStatus = 'pending' | 'open' | 'closed' | 'revealed';

export type InteractionType =
  | 'choice'
  | 'scale'
  | 'numeric'
  | 'text'
  | 'qna'
  | 'ranking'
  | 'fill-the-gaps'
  | 'match';

export type ChoiceDisplay =
  | 'bars'
  | 'columns'
  | 'donut'
  | 'pie'
  | 'radial'
  | 'emoji-pulse'
  | 'number'
  | 'tally'
  | 'emoji'
  | 'cards';
export type ScaleDisplay = 'dots' | 'gauge' | 'bars' | 'scale';
export type NumericDisplay = 'histogram' | 'number';
export type TextDisplay = 'list' | 'word-cloud' | 'wordcloud' | 'cards';
export type QnaDisplay = 'list' | 'cards';
export type RankingDisplay = 'ordered-bars' | 'sentence' | 'rank';
export type FillTheGapsDisplay = 'gaps' | 'bank' | 'choices';
export type MatchDisplay = 'pairs';
export type DisplayStyle =
  | ChoiceDisplay
  | ScaleDisplay
  | NumericDisplay
  | TextDisplay
  | QnaDisplay
  | RankingDisplay
  | FillTheGapsDisplay
  | MatchDisplay;

export type SortBy = 'order' | 'votes' | 'label';
export type ColorMode = 'series' | 'mono';
export type Orientation = 'horizontal' | 'vertical';

/** Chart attributes for the selected display (presentation-only). */
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

export interface Pedagogy {
  objective?: string;
  explanation?: string;
  followUp?: string;
  durationSec?: number;
}

/**
 * One styled span over an interaction's prompt. Structurally the schema's
 * `TextSpan`; declared here so the SDK keeps no type dependency on the schema.
 */
export interface TextSpanView {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Percent of the surface's base font, 25–400. */
  size?: number;
  family?: 'default' | 'display' | 'serif' | 'mono';
  /** #rrggbb only. */
  color?: string;
}

export interface BaseInteractionView {
  responseMode?: 'individual' | 'group';
  id: string;
  type: InteractionType;
  prompt: string;
  /**
   * Styled spans over `prompt`, concatenating exactly to it. Never present on a
   * fill-the-gaps interaction, whose prompt is drawn expanded from placeholders.
   */
  promptSpans?: TextSpanView[];
  display?: DisplayStyle;
  displayOptions?: DisplayOptions;
  resultVisibility?: 'hidden-until-close' | 'live';
  allowAnswerChange?: boolean;
  allowDontKnow?: boolean;
  pedagogy?: Pedagogy;
  /**
   * Optional live countdown length from the session. Clients should prefer
   * snapshot `closesAt` for the armed deadline while the interaction is open.
   */
  timerSec?: number;
}

export interface ChoiceOptionView {
  id: string;
  label: string;
  /** Styled spans over `label`, concatenating exactly to it. */
  labelSpans?: TextSpanView[];
  /** Only present once the interaction is revealed (API-06). */
  correct?: boolean;
  /** Only present once the interaction is revealed (API-06). */
  misconception?: string;
}

export interface ChoiceInteractionView extends BaseInteractionView {
  type: 'choice';
  options: ChoiceOptionView[];
  multiple?: boolean;
  display?: ChoiceDisplay;
  /** Peer instruction cycle: vote, discuss, revote. Single-select only. */
  peerInstruction?: boolean;
}

export interface RankingOptionView {
  id: string;
  label: string;
  /** Styled spans over `label`, concatenating exactly to it. */
  labelSpans?: TextSpanView[];
}

export interface RankingInteractionView extends BaseInteractionView {
  type: 'ranking';
  /** 2-6 options; a ballot orders all of them. */
  options: RankingOptionView[];
  display?: RankingDisplay;
  /** Only present once the interaction is revealed (API-06). */
  correctOrder?: string[];
}
export interface ScaleInteractionView extends BaseInteractionView {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  display?: ScaleDisplay;
}
export interface NumericInteractionView extends BaseInteractionView {
  type: 'numeric';
  unit?: string;
  /** Only present once the interaction is revealed (API-06). */
  correct?: number;
  /** Only present once the interaction is revealed (API-06). */
  tolerance?: number;
  display?: NumericDisplay;
}
/**
 * Locale / accent / punctuation policy for free-text answer matching. One
 * declaration for every interaction that matches typed text (text, fill-the-gaps) —
 * mirrors `TextMatch` in @openroom/schema, which the SDK cannot import.
 */
export interface TextMatch {
  locale?: string;
  accents?: 'require' | 'ignore';
  punctuation?: 'keep' | 'strip';
}

export interface TextInteractionView extends BaseInteractionView {
  type: 'text';
  maxLength?: number;
  display?: TextDisplay;
  /** Only present once the interaction is revealed (API-06). */
  correctAnswers?: string[];
  match?: TextMatch;
}
export interface QnaInteractionView extends BaseInteractionView {
  type: 'qna';
  display?: QnaDisplay;
}

export interface FillTheGapsInteractionView extends BaseInteractionView {
  type: 'fill-the-gaps';
  display?: FillTheGapsDisplay;
  /**
   * Family for the whole prompt. A fill-the-gaps prompt is drawn expanded from
   * `{{id}}` placeholders, so no span list can describe the characters on screen —
   * one family over the drawn sentence and its word bank is the styling it has.
   */
  promptFont?: 'default' | 'display' | 'serif' | 'mono';
  gaps: { id: string; answers?: string[]; options?: string[] }[];
  bankWords?: string[];
  match?: TextMatch;
}

export interface MatchInteractionView extends BaseInteractionView {
  type: 'match';
  display?: MatchDisplay;
  left: RankingOptionView[];
  right: RankingOptionView[];
  correct?: Record<string, string>;
}

export type InteractionView =
  | ChoiceInteractionView
  | ScaleInteractionView
  | NumericInteractionView
  | TextInteractionView
  | QnaInteractionView
  | RankingInteractionView
  | FillTheGapsInteractionView
  | MatchInteractionView;

/* --------------------------------------------------------------- outline view */

export interface OutlineCardView {
  label?: string;
  text: string;
  imageAssetId?: string;
  lane?: 0 | 1;
}

/** Typed region arrangement chosen for a step. Never CSS or coordinates. */
export type OutlineLayoutView =
  | 'title'
  | 'text'
  | 'split'
  | 'grid'
  | 'media'
  | 'poll'
  | 'activity'
  | 'timer'
  | 'join'
  | 'blank';

export type OutlineMediaFocalView =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

/** Named frame shape; orientation follows the ratio. */
export type OutlineMediaAspectView = '16:9' | '9:16' | '4:3' | '1:1';

export interface OutlineElementBoxView {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OutlineElementView =
  | {
      id: string;
      type: 'text';
      text: string;
      /** Styled spans over `text`; concatenation equals it. */
      spans?: TextSpanView[];
      align?: 'left' | 'center' | 'right';
      role?: 'heading' | 'body';
      box: OutlineElementBoxView;
    }
  | {
      id: string;
      type: 'image';
      url?: string;
      assetId?: string;
      alt: string;
      caption?: string;
      box: OutlineElementBoxView;
    }
  | { id: string; type: 'html'; html: string; css?: string; markdown?: string; box: OutlineElementBoxView }
  | { id: string; type: 'iframe'; url: string; title: string; box: OutlineElementBoxView }
  | { id: string; type: 'pdf'; url: string; title: string; box: OutlineElementBoxView };

/** A picture, video, or audio clip on a step. Shared by media and activity steps. */
export interface OutlineMediaView {
  listening?: { mode: 'room' | 'individual'; transcript?: string };
  type: 'image' | 'video' | 'audio';
  assetId?: string;
  url?: string;
  alt: string;
  caption?: string;
  focal?: OutlineMediaFocalView;
  aspect?: OutlineMediaAspectView;
  place?: 'left' | 'right' | 'top' | 'bottom' | 'fill';
  size?: number;
}

/** Presentation structure carried by every step; `tutorNotes` is already stripped. */
export interface OutlineStepViewBase {
  layout?: OutlineLayoutView;
  /** 'together', or ordered groups of the step's own part keys. */
  reveal?: 'together' | string[][];
  /** Set when the step is an on-demand detail hung off a part of another step. */
  breakoutOf?: { stepId: string; afterKey: string };
}

export type LearnerOutlineStep = OutlineStepViewBase &
  (
  | {
      id: string;
      kind: 'title';
      title: string;
      body?: string;
      /** Styled spans over `title`; concatenation equals it. */
      titleSpans?: TextSpanView[];
      /** Styled spans over `body`; concatenation equals it. */
      bodySpans?: TextSpanView[];
      media?: OutlineMediaView;
      elements?: OutlineElementView[];
    }
  | {
      id: string;
      kind: 'statement';
      title?: string;
      body: string;
      stat?: string;
      /** Styled spans over `title`; concatenation equals it. */
      titleSpans?: TextSpanView[];
      /** Styled spans over `body`; concatenation equals it. */
      bodySpans?: TextSpanView[];
      /** Styled spans over `stat`; concatenation equals it. */
      statSpans?: TextSpanView[];
      media?: OutlineMediaView;
      elements?: OutlineElementView[];
    }
  | {
      id: string;
      kind: 'cards';
      title: string;
      titleSpans?: TextSpanView[];
      items: OutlineCardView[];
      media?: OutlineMediaView;
    }
  | {
      id: string;
      kind: 'steps';
      title: string;
      titleSpans?: TextSpanView[];
      items: string[];
      media?: OutlineMediaView;
    }
  | {
      id: string;
      kind: 'term';
      term: string;
      meaning: string;
      example?: string;
      termSpans?: TextSpanView[];
      meaningSpans?: TextSpanView[];
      media?: OutlineMediaView;
    }
  | {
      id: string;
      kind: 'activity';
      title: string;
      titleSpans?: TextSpanView[];
      instructions: string[];
      materials?: string[];
      media?: OutlineMediaView;
      durationSec?: number;
    }
  | {
      id: string;
      kind: 'timer';
      title?: string;
      body?: string;
      seconds: number;
      style?: 'countdown' | 'countup' | 'bar-empty' | 'bar-fill' | 'hourglass' | 'ring';
      placement?: 'slide' | 'corner';
      persist?: boolean;
    }
  | {
      id: string;
      kind: 'media';
      title?: string;
      titleSpans?: TextSpanView[];
      media: OutlineMediaView;
      elements?: OutlineElementView[];
    }
  | {
      id: string;
      kind: 'debrief';
      title: string;
      titleSpans?: TextSpanView[];
      prompts: string[];
      media?: OutlineMediaView;
    }
  | {
      id: string;
      kind: 'break';
      title: string;
      body?: string;
      titleSpans?: TextSpanView[];
      bodySpans?: TextSpanView[];
      minutes?: number;
    }
  | { id: string; kind: 'join' }
  | {
      id: string;
      kind: 'blank';
      title?: string;
      titleSpans?: TextSpanView[];
      elements?: OutlineElementView[];
    }
  | {
      id: string;
      kind: 'interaction';
      interactionId: string;
      title?: string;
      body?: string;
      titleSpans?: TextSpanView[];
      bodySpans?: TextSpanView[];
      media?: OutlineMediaView;
    }
  );

export interface LearnerOutlineView {
  design?: ResolvedSlideDesign;
  outlineVersion: number;
  currentStepIndex: number;
  shownGroups?: number;
  stepCount: number;
  currentStep: LearnerOutlineStep;
  hiddenParts?: string[];
  /**
   * The learner's own pair-work lane. Participant snapshots only — the stage
   * has no lane, so it never carries this. `currentStep` is already filtered to
   * it; this only names which half of the pair the learner is.
   */
  yourLane?: 0 | 1;
}

/* ------------------------------------------------------- ballots/aggregates */

/**
 * A ballot as its own owner receives it (`ownAnswer` / `ownRound1Answer`) —
 * the domain's `OwnAnswer` projection, not its internal `Ballot`: the Q&A voter
 * ledger is stripped, and the fill-the-gaps moderation flag is not sent either (a
 * participant's own fill-the-gaps answer is never hidden from them).
 */
export type Ballot =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'scale'; value: number }
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; text: string; hidden: boolean }
  | { kind: 'qna'; text: string; hidden: boolean; votes: number }
  /** A complete permutation of the interaction's option ids, best first. */
  | { kind: 'ranking'; optionIds: string[] }
  | { kind: 'fill-the-gaps'; gaps: Record<string, string> }
  | { kind: 'match'; pairs: Record<string, string> }
  | { kind: 'dont-know' };

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
  | {
      kind: 'text';
      /** `handle` is the author's session-local handle; tutoring sessions only. */
      entries: { participantId: string; text: string; hidden: boolean; handle?: string }[];
      total: number;
    }
  | {
      kind: 'qna';
      entries: { participantId: string; text: string; hidden: boolean; votes: number }[];
      total: number;
    }
  /**
   * `scores` is a Borda count: with k options, position p (0-based) on a ballot
   * is worth k - p points. `avgRank` is the mean 1-based position, null while
   * `total` is 0.
   */
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

/* ------------------------------------------------------------- commands */

export type AnswerInput =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'scale'; value: number }
  | { kind: 'numeric'; value: number }
  | { kind: 'text'; text: string }
  | { kind: 'qna'; text: string }
  | { kind: 'ranking'; optionIds: string[] }
  | { kind: 'fill-the-gaps'; gaps: Record<string, string> }
  | { kind: 'match'; pairs: Record<string, string> }
  | { kind: 'dont-know' };

export type Command =
  | { command: 'presentation.handoff'; facilitatorId: string }
  | { command: 'presentation.recover' }
  | { command: 'group.set'; group: SessionGroupView }
  | { command: 'group.remove'; groupId: string }
  | { command: 'session.start'; cursor?: PresentationPosition }
  | { command: 'session.end' }
  | { command: 'session.freeze' }
  | { command: 'session.unfreeze' }
  | { command: 'interaction.open'; interactionId: string }
  | { command: 'interaction.close'; interactionId: string }
  | { command: 'interaction.reveal'; interactionId: string }
  | { command: 'interaction.hideResults'; interactionId: string }
  | { command: 'interaction.showResults'; interactionId: string }
  /** Peer instruction: archive round 1 and reopen the same question for round 2. */
  | { command: 'interaction.revote'; interactionId: string }
  /** Peer instruction: discard round 2 and restore the archived round-1 tally. */
  | { command: 'interaction.undoRevote'; interactionId: string }
  | { command: 'session.advance' }
  | { command: 'outline.goto'; stepId: string }
  | { command: 'outline.reveal'; stepId: string; shown: number }
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
  | { command: 'meaning.publish'; stepId: string; partKey: string; token: number; word: string; text?: string; entry?: DictionaryEntryView }
  | { command: 'meaning.clear'; stepId: string; partKey: string; token: number }
  | { command: 'listening.set'; stepId: string; mode?: 'room' | 'individual'; transcriptShown?: boolean }
  | {
      command: 'outline.insert';
      step: LearnerOutlineStep & { tutorNotes?: string };
      afterStepId?: string;
      show?: boolean;
      /**
       * The authored interaction a new poll step needs, exactly as
       * `Interaction` in @openroom/schema defines it. Left structurally open
       * here because the SDK imports no package — mirroring the whole union
       * would be the second copy this file exists to avoid.
       */
      interaction?: { id: string; type: InteractionType; prompt: string };
    }
  | {
      command: 'outline.replace';
      stepId: string;
      step: LearnerOutlineStep & { tutorNotes?: string };
    }
  /** Host-only live theme switch. `theme` is one of the five @openroom/ui ids. */
  | { command: 'session.theme'; theme: string }
  | { command: 'session.display'; display: DisplayStyle }
  | { command: 'timer.start' }
  | { command: 'timer.pause' }
  | { command: 'timer.reset' }
  | { command: 'timer.adjust'; seconds: number }
  | { command: 'text.hide'; interactionId: string; participantId: string }
  | { command: 'text.unhide'; interactionId: string; participantId: string }
  | { command: 'answer.submit'; interactionId: string; answer: AnswerInput; groupId?: string }
  | { command: 'qna.vote'; interactionId: string; targetParticipantId: string }
  /** Session Q&A: ask (or edit your own) question; `questionId` is client-minted. */
  | { command: 'qna.ask'; questionId: string; text: string }
  /** Session Q&A: one upvote per participant per question. */
  | { command: 'qna.upvote'; questionId: string }
  /** Session Q&A moderation (host-only). */
  | { command: 'qna.hide'; questionId: string }
  | { command: 'qna.unhide'; questionId: string }
  /** Host: what the stage shows for session Q&A (off / full list / one question). */
  | { command: 'qna.stage'; mode: 'off' | 'list' | 'spotlight'; questionId?: string };

export type Role = 'host' | 'participant' | 'stage';

export type DomainErrorCode =
  | 'E_REVISION_CONFLICT'
  | 'E_INVALID_TRANSITION'
  | 'E_NOT_OPEN'
  | 'E_FROZEN'
  | 'E_FORBIDDEN'
  | 'E_UNKNOWN_INTERACTION'
  | 'E_NO_OUTLINE'
  | 'E_UNKNOWN_OUTLINE_STEP'
  | 'E_INVALID_OUTLINE_STEP'
  | 'E_INVALID_ANSWER'
  | 'E_INVALID_THEME'
  | 'E_INVALID_DISPLAY'
  | 'E_ENDED';

export interface DomainError {
  code: DomainErrorCode | string;
  message: string;
}

export type SubmitResult =
  | { ok: true; revision: number }
  | { ok: false; error: DomainError };

/* ------------------------------------------------------- session Q&A views */

export type QnaStagePlacement =
  | { mode: 'off' }
  | { mode: 'list' }
  | { mode: 'spotlight'; questionId: string };

/** A session Q&A question as a participant sees it. Voter lists are never sent. */
export interface ParticipantQnaQuestion {
  id: string;
  text: string;
  votes: number;
  own: boolean;
  votedByYou: boolean;
  /** Only ever true on the participant's OWN moderated question. */
  hidden: boolean;
  /** Asker's session-local handle (pseudonymous sessions only) — system-assigned, not PII. */
  handle?: string;
}

export interface ParticipantQnaView {
  maxLength: number;
  questions: ParticipantQnaQuestion[];
}

export interface StageQnaView {
  stage: QnaStagePlacement;
  /** Visible questions only, votes-descending. */
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

/* ------------------------------------------------------------ snapshots */

/** One piece of tutor ink, as every surface receives it. */
export type SessionMarkView = { id: string } & (
  /** `endToken` (inclusive, same part) marks a span of words; absent marks one. */
  | { kind: MarkShape; partKey: string; token: number; endToken?: number; color?: InkColor }
  | { kind: 'pen'; points: { x: number; y: number }[]; color?: InkColor }
);

/** The tutor's typed translation of one token; `shown` publishes it. */
export interface SessionMeaningView {
  partKey: string;
  token: number;
  /** The word as it stands on the slide, so the card can name it off-slide. */
  word?: string;
  text: string;
  shown: boolean;
}

/**
 * One row of a forms table: a label and one cell per column. A `null` cell is
 * a form the language does not have, not a form we failed to fetch.
 */
export interface DictionaryFormRowView {
  label: string;
  cells: (string | null)[];
}

/**
 * A block of forms sharing the same grammatical section — one tense, one
 * degree, one declension. Sections come from tags, not from the part of
 * speech, which is why nouns and verbs render through the same component.
 */
export interface DictionaryFormSectionView {
  key: string;
  label: string;
  columnLabels: string[];
  rows: DictionaryFormRowView[];
}

/**
 * A dictionary entry, as it crosses the wire.
 *
 * Structurally mirrors `DictionaryEntry` in @openroom/schema, which the SDK
 * cannot import. Kept in sync by hand, like `TextMatch` above.
 */
export interface DictionaryEntryView {
  word: string;
  lemma: string;
  lang: string;
  pos: string;
  headword?: string;
  labels: string[];
  senses: { gloss: string; tags?: string[]; example?: string }[];
  sections: DictionaryFormSectionView[];
  resolvedFrom?: string;
  source: { name: string; url: string };
}

/** A forms table on the wall. Present only while projected. */
export interface SessionDictionaryView {
  id: string;
  partKey: string;
  token: number;
  entry: DictionaryEntryView;
}

export interface ParticipantSnapshot {
  yourLabel?: string;
  yourGroup?: { id: string; name: string; isSpokesperson: boolean };
  revision: number;
  status: SessionStatus;
  frozen: boolean;
  /**
   * Active session theme id — 'default' | 'chalkboard' | 'paper' | 'projector' |
   * 'sherbet'. Feed it through `resolveTheme()` from @openroom/ui before use.
   */
  theme?: string;
  /** Active interaction, stripped of pre-reveal secrets. */
  interaction: InteractionView | null;
  interactionStatus: InteractionStatus | null;
  /**
   * Absolute ms deadline when the active interaction will auto-close.
   * Present only while open with a session `timerSec`.
   */
  closesAt?: number;
  /** True when this participant has a ballot for the active interaction. */
  answered: boolean;
  /** This participant's own current ballot for the active interaction. */
  ownAnswer: Ballot | null;
  /** Present only when results are revealable to participants. */
  aggregate: Aggregate | null;
  /** Peer instruction round of the active interaction. */
  round?: 1 | 2;
  /**
   * The round-1 tally of a peer-instruction interaction. Present once a revote
   * has happened; `null` until the interaction is revealed (anti-anchoring).
   */
  round1Aggregate?: Aggregate | null;
  /** This participant's own round-1 ballot, so they can recall their first vote. */
  ownRound1Answer?: Ballot | null;
  /** Own session-local handle (pseudonymous sessions only); peers' handles are never sent. */
  yourHandle?: string;
  /** Session-wide audience Q&A; present only when the session enables it. */
  qna?: ParticipantQnaView;
  outline?: LearnerOutlineView;
  listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean };
  marks?: SessionMarkView[];
  meaning?: SessionMeaningView;
  dictionary?: SessionDictionaryView;
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClockView;
  /** Identity regime of the session: 'anonymous' | 'pseudonymous' | 'identified'. */
  identityMode?: string;
}

export interface StageSnapshot {
  role: 'stage';
  revision: number;
  status: SessionStatus;
  /** Active session theme id; see `ParticipantSnapshot.theme`. */
  theme?: string;
  code: string;
  /** Path (or absolute URL) participants should open to join. */
  joinUrl: string;
  frozen: boolean;
  participantCount: number;
  expectedAnswerCount?: number;
  answeredCount: number;
  interaction: InteractionView | null;
  interactionStatus: InteractionStatus | null;
  /**
   * Absolute ms deadline when the active interaction will auto-close.
   * Present only while open with a session `timerSec`.
   */
  closesAt?: number;
  /** Present only when results are revealable. */
  aggregate: Aggregate | null;
  /** Peer instruction round of the active interaction. */
  round?: 1 | 2;
  /**
   * The round-1 tally of a peer-instruction interaction. Present once a revote
   * has happened; `null` until the interaction is revealed (anti-anchoring).
   */
  round1Aggregate?: Aggregate | null;
  /** Session-wide audience Q&A; present only when the session enables it. */
  qna?: StageQnaView;
  outline?: LearnerOutlineView;
  listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean };
  marks?: SessionMarkView[];
  meaning?: SessionMeaningView;
  dictionary?: SessionDictionaryView;
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClockView;
}

export interface HostInteractionSummary {
  id: string;
  type: InteractionType;
  prompt: string;
  status: InteractionStatus;
  answered: number;
  openedAt?: number;
  closedAt?: number;
  /** Absolute ms auto-close deadline while this interaction is open with a timer. */
  closesAt?: number;
  /** True when the host blanked audience/stage results. */
  resultsHidden?: boolean;
  /** Whether participant/stage currently see aggregates for this interaction. */
  resultsVisible?: boolean;
  /** Peer instruction round; absent when the interaction is not a PI cycle. */
  round?: 1 | 2;
  /** Archived round-1 tally. The host sees it immediately, reveal or not. */
  round1Aggregate?: Aggregate;
  /** Effective chart display (live override ?? authored). */
  display?: DisplayStyle;
}

export interface SessionGroupView {
  id: string;
  name: string;
  memberIds: string[];
  spokespersonId: string | null;
}

export interface FacilitationView {
  presenterId: string;
  facilitators: { id: string; name: string }[];
  yourId: string;
  canPresent: boolean;
  canRecover: boolean;
}

export interface HostSnapshot {
  facilitation: FacilitationView;
  groups?: SessionGroupView[];
  participants?: { id: string; label: string }[];
  responseNames?: Record<string, string>;
  revision: number;
  status: SessionStatus;
  /** Active session theme id; see `ParticipantSnapshot.theme`. */
  theme?: string;
  code: string;
  joinUrl: string;
  frozen: boolean;
  participantCount: number;
  expectedAnswerCount?: number;
  answeredCount: number;
  activeInteractionId: string | null;
  interactions: HostInteractionSummary[];
  interaction: InteractionView | null;
  interactionStatus: InteractionStatus | null;
  /** Absolute ms auto-close deadline for the active interaction, when armed. */
  closesAt?: number;
  aggregate: Aggregate | null;
  /** Peer instruction round of the active interaction. */
  round?: 1 | 2;
  /** Archived round-1 tally of the active interaction; the host is never gated. */
  round1Aggregate?: Aggregate | null;
  /** participantId → session-local handle; present only in pseudonymous sessions. */
  handles?: Record<string, string>;
  /** Session-wide audience Q&A; always present (enabled: false when the session omits it). */
  qna?: HostQnaView;
  listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean };
  marks?: SessionMarkView[];
  meaning?: SessionMeaningView;
  dictionary?: SessionDictionaryView;
  /** Host shape includes the full authored outline, including tutor-only notes. */
  outline?: {
    outlineVersion: number;
    currentStepIndex: number;
  shownGroups?: number;
    content: { version: 1; meta: { title: string }; steps: (LearnerOutlineStep & { tutorNotes?: string })[]; interactions: unknown[] };
  };
  /**
   * Classroom clock. Independent of the current slide. Clients tick locally
   * from remainingSecAt / remainingSec while `running`.
   */
  clock?: SessionClockView;
}

export interface SessionClockView {
  stepId: string;
  authoredSec: number;
  remainingSecAt: number;
  remainingSec: number;
  running: boolean;
  placement: 'slide' | 'corner';
}

export type Snapshot = ParticipantSnapshot | StageSnapshot | HostSnapshot;

/**
 * Wire message pushed over the WebSocket notification channel.
 */
export interface SessionChangedMessage {
  v: 1;
  type: 'session.changed';
  revision: number;
}

export interface JoinResult {
  /** The 8-character live session code. */
  sessionCode: string;
  participantToken: string;
  participantId: string;
  /** 'anonymous' | 'pseudonymous'; older workers omit it. */
  identityMode?: string;
  /** Session-local handle, present only in pseudonymous sessions. */
  handle?: string;
}

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline';
