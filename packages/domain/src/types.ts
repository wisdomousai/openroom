import type {
  DictionaryEntry,
  Display,
  Interaction,
  LearnerOutlineStep,
  Outline,
  PresentationPosition,
  ResolvedSlideDesign,
} from '@openroom/schema';

export type SessionStatus = 'lobby' | 'live' | 'ended';

export interface SessionListening {
  stepId: string;
  mode: 'room' | 'individual';
  transcriptShown: boolean;
}

/**
 * The built-in theme ids a session may carry. Kept as a plain string list (and
 * `SessionState.theme` as a plain `string`) so the domain stays free of any
 * dependency on `@openroom/ui`; the list must mirror `ThemeId` there and
 * `SessionThemeId` in `@openroom/schema`.
 */
export const SESSION_THEME_IDS = [
  'default',
  'chalkboard',
  'paper',
  'projector',
  'sherbet',
] as const;

export const DEFAULT_ROOM_THEME = 'default';

/** True for one of the five known theme ids. */
export function isKnownTheme(value: unknown): value is string {
  return typeof value === 'string' && (SESSION_THEME_IDS as readonly string[]).includes(value);
}

export type InteractionStatus = 'pending' | 'open' | 'closed' | 'revealed';

export interface ParticipantRecord {
  joinedAt: number;
  /**
   * Session-local handle. In pseudonymous sessions it is generated; in identified
   * sessions it is the name forwarded from the context access link. Host-visible
   * and shown to the participant themselves; never exposed to other
   * participants or the stage.
   */
  handle?: string;
  /**
   * Stable identified-join key (the access-link id). Never the `orlnk_…`
   * token. Used to re-enter as the same participant after a reload.
   */
  seatKey?: string;
  /** Pair-work card projection, assigned once from join order. */
  lane?: 0 | 1;
}

export type Ballot =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'scale'; value: number }
  | { kind: 'numeric'; value: number }
  /** hidden = blocklisted or host-removed */
  | { kind: 'text'; text: string; hidden: boolean }
  /**
   * `voters` is the authoritative vote ledger (one vote per participant per entry).
   * `votes === voters.length` always. Voter lists are host-only and are stripped
   * from participant and stage snapshots.
   */
  | { kind: 'qna'; text: string; hidden: boolean; votes: number; voters: string[] }
  /** a complete permutation of the interaction's option ids, best first */
  | { kind: 'ranking'; optionIds: string[] }
  | { kind: 'fill-the-gaps'; gaps: Record<string, string>; hidden: boolean }
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
      entries: { participantId: string; text: string; hidden: boolean; handle?: string }[];
      total: number;
    }
  | {
      kind: 'qna';
      entries: { participantId: string; text: string; hidden: boolean; votes: number }[];
      total: number;
    }
  /**
   * `scores` is a Borda count: with k options, the option a ballot puts in
   * position p (0-based) receives k - p points. `avgRank` is the mean 1-based
   * position of the option, or null while `total` is 0.
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
      entries: {
        participantId: string;
        gaps: Record<string, string>;
        hidden: boolean;
        handle?: string;
      }[];
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

export interface InteractionRuntime {
  /** Group names at first submission; later renaming never relabels a recorded response. */
  groupNames?: Record<string, string>;
  status: InteractionStatus;
  /** key = participantId; a replacement ballot is an answer change */
  ballots: Record<string, Ballot>;
  /** recomputed on every write and stored */
  aggregate: Aggregate;
  openedAt?: number;
  closedAt?: number;
  /**
   * Absolute ms when the open interaction's advisory window drains. Set from
   * the session `timerSec` on open / advance / revote; cleared on close / reveal.
   * Zero never closes answering — the teacher closes.
   */
  closesAt?: number;
  /**
   * Live chart override. Does not dirty the authored outline.
   * Snapshots expose `override ?? authored`.
   */
  displayOverride?: Display;
  /**
   * Host-requested blank of audience/stage aggregates without changing status.
   * Cleared by `interaction.showResults` / `interaction.reveal` / reopen.
   */
  resultsHidden?: boolean;
  /**
   * Peer instruction round. Only set on interactions with
   * `peerInstruction: true`; absent means round 1.
   */
  round?: 1 | 2;
  /**
   * Round-1 archive, written by `interaction.revote`. Anti-anchoring: the
   * archived aggregate reaches participant/stage snapshots only once the
   * interaction is `revealed`; the host always sees it.
   */
  round1?: { ballots: Record<string, Ballot>; aggregate: Aggregate };
}

/* ------------------------------------------------------------------ */
/* Session-wide audience Q&A                                           */
/* ------------------------------------------------------------------ */

/**
 * One audience question. Lives in `SessionState.qna`, not in any interaction:
 * session Q&A is open for the whole session, independent of the active block.
 */
export interface QnaQuestion {
  /** Client-minted id (same trust model as idempotency keys), 1-64 chars. */
  id: string;
  participantId: string;
  text: string;
  /** blocklisted or host-moderated */
  hidden: boolean;
  /** `votes === voters.length` always */
  votes: number;
  /**
   * Authoritative one-upvote-per-participant ledger. Never leaves domain
   * snapshots — not even the host's.
   */
  voters: string[];
  /** `now` at ask time; edits keep the original timestamp */
  createdAt: number;
}

/** What the projector shows for session Q&A: nothing, the list, or one question. */
export type QnaStagePlacement =
  | { mode: 'off' }
  | { mode: 'list' }
  | { mode: 'spotlight'; questionId: string };

export interface QnaState {
  /** from `outline.content.qna.enabled`; every qna.* command fails E_FORBIDDEN when false */
  enabled: boolean;
  stage: QnaStagePlacement;
  /** key = question id */
  questions: Record<string, QnaQuestion>;
}

export interface SessionState {
  facilitation: {
    presenterId: string;
    facilitators: Record<string, SessionFacilitator>;
  };
  /** 8-char Crockford-base32 join code, vowels and ambiguous glyphs removed */
  code: string;
  status: SessionStatus;
  /** monotonic; bumps on every applied mutation */
  revision: number;
  /**
   * The outline this session is running — the same document a deck stores in
   * `deck_versions.content_json`. Always present: classroom poll lists compile
   * to interaction steps before the session is created.
   */
  outline: OutlineSessionState;
  /**
   * Active theme id for every surface of this session. Initialized from
   * `outline.content.defaults.theme` and switched live by the host `session.theme` command.
   * Always one of `SESSION_THEME_IDS`.
   */
  theme: string;
  activeInteractionId: string | null;
  interactions: Record<string, InteractionRuntime>;
  /** session-wide audience Q&A; disabled-and-empty unless the outline enables it */
  qna: QnaState;
  participants: Record<string, ParticipantRecord>;
  /**
   * Most participants this session admits. Fixed at creation from the space
   * owner's billing (`largeSessions`); absent admits any number. Re-entry of an
   * admitted participant never counts against it.
   */
  participantLimit?: number;
  groups?: Record<string, SessionGroup>;
  /** Ephemeral tutor ink. Cleared on outline navigation and session end. */
  marks?: SessionMark[];
  listening?: SessionListening;
  /** Tutor-typed meaning of a token. `shown` publishes it to stage and phones. */
  meaning?: SessionMeaning;
  /**
   * The forms table on the wall. Present only while projected — the command is
   * the projection, so there is no `shown` flag and no private draft here.
   */
  dictionary?: SessionDictionary;
  /**
   * Live classroom clock. Independent of `currentStepIndex` so a running timer
   * can persist in the corner after the teacher leaves the timer slide.
   *
   * Clients tick locally while `running`:
   *   remaining = remainingSec − (now − remainingSecAt) / 1000
   * Zero never auto-closes anything; remaining may go negative (overtime).
   */
  clock?: SessionClock;
  /** panic: no submissions, participant text hidden on stage */
  frozen: boolean;
  endedAt?: number;
  /** set by `purgeBallots` once the per-person layer has been dropped (PRD DATA-04) */
  purgedAt?: number;
}

export type TimerPlacement = 'slide' | 'corner';

/**
 * Remaining-at-timestamp clock. `remainingSec` is the remaining seconds at
 * `remainingSecAt` (epoch ms). While `running`, clients compute
 * `remainingSec - (now - remainingSecAt) / 1000` locally. Reset returns to
 * `authoredSec` from the outline step and never rewrites the document.
 */
export interface SessionClock {
  /** Outline timer step this clock is bound to. */
  stepId: string;
  /** Authored duration from the outline step; reset returns here. */
  authoredSec: number;
  /** Epoch ms at which `remainingSec` was sampled. */
  remainingSecAt: number;
  /** Remaining seconds at `remainingSecAt`. May go negative after zero. */
  remainingSec: number;
  running: boolean;
  placement: TimerPlacement;
}

/**
 * Tutor ink colours — a closed enum, like every other authored choice. The wire
 * carries the name; each surface owns the pixels it paints for it.
 */
export const INK_COLORS = ['red', 'yellow', 'green'] as const;

export type InkColor = (typeof INK_COLORS)[number];

/**
 * Marks that name words rather than pixels. Each is anchored to a part and a
 * token, so it survives a reflow and lands on the same word on every screen.
 */
export const TOKEN_MARK_KINDS = [
  'circle',
  'rectangle',
  'underline',
  'strikethrough',
  'highlight',
] as const;

export type TokenMarkKind = (typeof TOKEN_MARK_KINDS)[number];

/** A mark as the tutor draws it — the session gives it its identity on the way in. */
export type SessionMarkInput =
  /**
   * One shape over words. `token` alone marks a word; `endToken` extends it to
   * the last word of a span in the same part (inclusive), which is what a tutor
   * gets by dragging a line across a phrase. Absent means a single word, so
   * every mark written before spans existed still reads.
   */
  | {
      kind: TokenMarkKind;
      partKey: string;
      token: number;
      endToken?: number;
      color?: InkColor;
    }
  | { kind: 'pen'; points: { x: number; y: number }[]; color?: InkColor };

/**
 * A stored mark. `id` is assigned by the reducer from the revision it lands on
 * (`m12`) — a session's own clock, so replaying the same commands rebuilds the
 * same ids and `mark.remove` names one mark for every client at once.
 */
export type SessionMark = SessionMarkInput & { id: string };

/**
 * The tutor's short translation of one word into the student's language.
 *
 */
export interface SessionMeaning {
  partKey: string;
  token: number;
  /** The word as it stands on the slide, so the card can name it off-slide. */
  word?: string;
  text: string;
  shown: boolean;
}

/**
 * A dictionary entry projected onto the wall.
 *
 * `id` is assigned by the reducer from the revision it lands on (`d12`), the
 * same "the revision it lands on is its name" rule marks use, so a replay
 * rebuilds the same id. One wall, one table: a second publication
 * replaces this outright, which is what keeps the snapshot bounded.
 */
export interface SessionDictionary {
  id: string;
  partKey: string;
  token: number;
  entry: DictionaryEntry;
}

export interface OutlineSessionState {
  outlineVersion: number;
  /** Full authored outline, including tutor-only notes. Only host snapshots expose it. */
  content: Outline;
  currentStepIndex: number;
  shownGroups?: number;
}

export interface LearnerOutlineView {
  design?: ResolvedSlideDesign;
  outlineVersion: number;
  currentStepIndex: number;
  shownGroups?: number;
  stepCount: number;
  currentStep: LearnerOutlineStep;
  hiddenParts?: string[];
  /**
   * The learner's own pair-work lane. Present only when this session assigns
   * lanes; the stage has no lane at all, so it never carries this. `currentStep`
   * is already filtered to it — this is only so the learner can be told which
   * half of the pair they are.
   */
  yourLane?: 0 | 1;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

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

export interface SessionGroup {
  id: string;
  name: string;
  memberIds: string[];
  spokespersonId: string | null;
  /** Removed groups retain their id so a later group cannot inherit their ballots. */
  removed?: boolean;
}

export interface SessionFacilitator {
  id: string;
  name: string;
  /** The session creator and space owner can explicitly recover presentation control. */
  canRecover: boolean;
}

export type Command =
  | { command: 'presentation.handoff'; facilitatorId: string }
  | { command: 'presentation.recover' }
  | { command: 'group.set'; group: Omit<SessionGroup, 'removed'> }
  | { command: 'group.remove'; groupId: string }
  | { command: 'session.start'; cursor?: PresentationPosition }
  | { command: 'session.end' }
  | { command: 'session.freeze' }
  | { command: 'session.unfreeze' }
  | { command: 'interaction.open'; interactionId: string }
  | { command: 'interaction.close'; interactionId: string }
  | { command: 'interaction.reveal'; interactionId: string }
  /**
   * Blank audience/stage results without closing voting or deleting ballots.
   * Host-only. Cleared by showResults / reveal / reopen.
   */
  | { command: 'interaction.hideResults'; interactionId: string }
  /**
   * Clear a host blank so live (or already-revealed) results show again.
   * Does not change status — use reveal to unlock answer keys / mark revealed.
   */
  | { command: 'interaction.showResults'; interactionId: string }
  /**
   * Peer instruction: archive round 1 and reopen the same question for round 2.
   * Host-only, valid on a closed `peerInstruction` choice interaction in round 1.
   */
  | { command: 'interaction.revote'; interactionId: string }
  /**
   * Peer instruction: discard round 2 and restore the archived round-1 ballots.
   * Host-only. Valid whenever a round-1 archive exists (open/closed/revealed in round 2).
   * Lands on closed round 1 so the host can discuss again, revote, or reveal R1.
   */
  | { command: 'interaction.undoRevote'; interactionId: string }
  /** open the next pending interaction, closing the current one */
  | { command: 'session.advance' }
  /** Navigate a tutoring session by authored outline step, atomically managing interactions. */
  | { command: 'outline.goto'; stepId: string }
  | { command: 'outline.reveal'; stepId: string; shown: number }
  | { command: 'outline.next' }
  | { command: 'outline.previous' }
  | { command: 'mark.set'; mark: SessionMarkInput }
  /** Rub out exactly one mark. Unknown ids are a silent success (retry safety). */
  | { command: 'mark.remove'; id: string }
  | { command: 'mark.clear' }
  /** Publish the chosen meaning and forms together on the current slide. Drafts stay local. */
  | { command: 'meaning.publish'; stepId: string; partKey: string; token: number; word: string; text?: string; entry?: DictionaryEntry }
  | { command: 'meaning.clear'; stepId: string; partKey: string; token: number }
  | { command: 'listening.set'; stepId: string; mode?: 'room' | 'individual'; transcriptShown?: boolean }
  /**
   * Add an approved live step. Stays private unless `show` is true.
   * When `step.kind` is `interaction`, pass `interaction` so the session gains
   * the poll before the step is navigated to.
   */
  | {
      command: 'outline.insert';
      step: Outline['steps'][number];
      afterStepId?: string;
      show?: boolean;
      /** Required when inserting an interaction step. */
      interaction?: Interaction;
    }
  /**
   * Rewrite a content slide already in the live outline (term, statement, …).
   * Interaction steps are rejected — live polls keep their ballots.
   */
  | {
      command: 'outline.replace';
      stepId: string;
      step: Outline['steps'][number];
    }
  /** host-only live theme switch; `theme` must be one of `SESSION_THEME_IDS` */
  | { command: 'session.theme'; theme: string }
  /**
   * Host-only live chart override for the active interaction. Must be a display
   * `displaysFor(type)` allows. Does not dirty the outline.
   */
  | { command: 'session.display'; display: Display }
  /** Start or resume the classroom clock. Never auto-starts on slide land. */
  | { command: 'timer.start' }
  | { command: 'timer.pause' }
  /** Back to the authored duration, stopped. Does not rewrite the outline. */
  | { command: 'timer.reset' }
  /** Signed seconds delta, e.g. ±60. */
  | { command: 'timer.adjust'; seconds: number }
  | { command: 'text.hide'; interactionId: string; participantId: string }
  | { command: 'text.unhide'; interactionId: string; participantId: string }
  | { command: 'answer.submit'; interactionId: string; answer: AnswerInput; groupId?: string }
  | { command: 'qna.vote'; interactionId: string; targetParticipantId: string }
  /** session Q&A: ask (or edit your own) question; `questionId` is client-minted */
  | { command: 'qna.ask'; questionId: string; text: string }
  /** session Q&A: one upvote per participant per question */
  | { command: 'qna.upvote'; questionId: string }
  /** session Q&A moderation (host) */
  | { command: 'qna.hide'; questionId: string }
  | { command: 'qna.unhide'; questionId: string }
  /** host: what the stage shows for session Q&A (off / full list / one question) */
  | { command: 'qna.stage'; mode: 'off' | 'list' | 'spotlight'; questionId?: string };

export type CommandName = Command['command'];

export type Actor = { role: 'host' | 'participant' | 'stage'; participantId?: string; facilitatorId?: string };

export interface CommandEnvelope {
  idempotencyKey: string;
  expectedRevision?: number;
  actor: Actor;
  command: Command;
}

export type Effect = { type: 'notify' };

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
  code: DomainErrorCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; state: SessionState; revision: number; effects: Effect[] }
  | { ok: false; error: DomainError };
