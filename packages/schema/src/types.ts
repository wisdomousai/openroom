/**
 * TypeScript mirror of `schema/session.schema.json` (JSON Schema draft 2020-12).
 * The JSON Schema is normative; these types must stay in sync with it.
 *
 * `Session` here is the interaction bag Outline extracts (`toSession`).
 * It is not the product Session (a started instance of a deck) and not a
 * startable document. The file is a deck; its JSON is Outline v1.
 */

import type { SpanFontFamily, TextSpan } from './outline-types.js';

export type ResultVisibility = 'hidden-until-close' | 'live';
/**
 * The five built-in theme ids. Mirrors `ThemeId` in `@openroom/ui`; declared
 * here rather than imported so the schema package keeps zero UI dependencies.
 */
export type SessionThemeId = 'default' | 'chalkboard' | 'paper' | 'projector' | 'sherbet';
export const SESSION_THEME_IDS = [
  'default',
  'chalkboard',
  'paper',
  'projector',
  'sherbet',
] as const satisfies readonly SessionThemeId[];
/**
 * How a participant is named inside one session.
 *
 * - `anonymous`     — no handle at all.
 * - `pseudonymous`  — a system-assigned session-local handle (`@openroom/domain`
 *   wordlist). The default.
 * - `identified`    — the participant arrives holding a context access link and
 *   is named by that context's `displayName`. There is still no participant
 *   account: the link is a revocable, context-scoped capability, nothing more.
 *
 * - `roster`        — host-typed named seats. Enterable only with that session's
 *   `orinv_…`. Not a context access link. Lobby join is allowed.
 */
export type IdentityMode = 'anonymous' | 'pseudonymous' | 'identified' | 'roster';

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
export type Display =
  | ChoiceDisplay
  | ScaleDisplay
  | NumericDisplay
  | TextDisplay
  | QnaDisplay
  | RankingDisplay
  | FillTheGapsDisplay
  | MatchDisplay;

export type {
  ColorMode,
  DisplayOptions,
  Orientation,
  SortBy,
} from './display-options.js';
import type { DisplayOptions } from './display-options.js';

export interface SessionMeta {
  title: string;
  description?: string;
  locale?: string;
  source?: string;
}

export interface SessionDefaults {
  identityMode?: IdentityMode;
  resultVisibility?: ResultVisibility;
  allowAnswerChange?: boolean;
  /**
   * Built-in `@openroom/ui` theme id for every surface of the session. Defaults to
   * `'default'`; the host can override it live with the `session.theme` command.
   */
  theme?: SessionThemeId;
}

export interface Pedagogy {
  objective?: string;
  explanation?: string;
  followUp?: string;
  durationSec?: number;
}

export interface BaseInteraction {
  id: string;
  type: InteractionType;
  prompt: string;
  /**
   * Styled spans over `prompt`, authoritative when present and concatenating
   * exactly to it. They live on the interaction rather than the step because
   * the participant ballot and the stage aggregate both read the prompt from
   * the session — styling it here reaches every surface at once.
   *
   * Forbidden on `fill-the-gaps`: its prompt holds `{{id}}` placeholders, so
   * the stored string is not the string anything draws.
   */
  promptSpans?: TextSpan[];
  display?: Display;
  /** Chart attributes for the selected display; irrelevant keys are stripped on normalize. */
  displayOptions?: DisplayOptions;
  resultVisibility?: ResultVisibility;
  allowAnswerChange?: boolean;
  /** Group questions accept one shared ballot, submitted by the assigned spokesperson. */
  responseMode?: 'individual' | 'group';
  allowDontKnow?: boolean;
  /** Host-only. Never sent to participant or stage. */
  notes?: string;
  pedagogy?: Pedagogy;
  /**
   * Optional live countdown in seconds (1–7200). Distinct from
   * `pedagogy.durationSec` (estimated teaching time). When set, opening the
   * interaction arms a `closesAt` advisory window. Zero never closes answering;
   * the teacher closes. No speed-based scoring.
   */
  timerSec?: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
  /** Styled spans over `label`. Concatenation must equal it. */
  labelSpans?: TextSpan[];
  correct?: boolean;
  misconception?: string;
}

export interface ChoiceInteraction extends BaseInteraction {
  type: 'choice';
  display?: ChoiceDisplay;
  options: ChoiceOption[];
  multiple?: boolean;
  /**
   * Peer instruction (vote → discuss → revote). Only meaningful on a
   * single-select choice interaction; the validator rejects it anywhere else
   * with `E_PEER_INSTRUCTION_CONFIG`.
   */
  peerInstruction?: boolean;
}

/** Ranking options carry no per-option correctness — use interaction `correctOrder`. */
export interface RankingOption {
  id: string;
  label: string;
  /** Styled spans over `label`. Concatenation must equal it. */
  labelSpans?: TextSpan[];
}

export interface RankingInteraction extends BaseInteraction {
  type: 'ranking';
  display?: RankingDisplay;
  /** 2-6 options; participants order all of them. */
  options: RankingOption[];
  /**
   * Optional correct permutation of `options[].id` (best first). Preference
   * ranking still aggregates with Borda; this is quiz-style reveal metadata.
   */
  correctOrder?: string[];
}

export interface ScaleInteraction extends BaseInteraction {
  type: 'scale';
  display?: ScaleDisplay;
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface NumericInteraction extends BaseInteraction {
  type: 'numeric';
  display?: NumericDisplay;
  unit?: string;
  correct?: number;
  /** Requires `correct` to be present. */
  tolerance?: number;
}

export interface TextMatch {
  locale?: string;
  accents?: 'require' | 'ignore';
  punctuation?: 'keep' | 'strip';
}

export interface TextInteraction extends BaseInteraction {
  type: 'text';
  display?: TextDisplay;
  /** Default 200, hard cap 500. */
  maxLength?: number;
  /**
   * Accepted short-text answers for quiz-style reveal. Matching uses
   * `normalizeTextAnswer` with optional `match` rules. Never sent pre-reveal.
   */
  correctAnswers?: string[];
  /** Locale / accent / punctuation policy for `correctAnswers`. */
  match?: TextMatch;
}

export interface QnaInteraction extends BaseInteraction {
  type: 'qna';
  display?: QnaDisplay;
}

export interface FillTheGapsGap {
  id: string;
  /** Accepted answers for this gap. Stripped until reveal. */
  answers: string[];
  /**
   * Wrong options for the `choices` picker. Never repeats an accepted answer.
   * Combined with `answers[0]` on the wire as shuffled `options`.
   */
  distractors?: string[];
}

export interface FillTheGapsInteraction extends BaseInteraction {
  type: 'fill-the-gaps';
  display?: FillTheGapsDisplay;
  /**
   * Font family for the whole drawn prompt. The one style this prompt can
   * carry: the stored string holds `{{id}}` placeholders, so per-character
   * spans cannot describe what is drawn.
   */
  promptFont?: SpanFontFamily;
  /** Prompt with `{{id}}` placeholders matching `gaps[].id`. */
  gaps: FillTheGapsGap[];
  /**
   * Extra wrong words for the shared `bank` display. The pool is every gap's
   * `answers[0]` ∪ this list. Stripped; participants see `bankWords`.
   */
  bank?: string[];
  match?: TextMatch;
}

export interface MatchItem {
  id: string;
  label: string;
  /** Styled spans over `label`. Concatenation must equal it. */
  labelSpans?: TextSpan[];
}

export interface MatchInteraction extends BaseInteraction {
  type: 'match';
  display?: MatchDisplay;
  left: MatchItem[];
  right: MatchItem[];
  /** Complete map of left id → right id. Stripped until reveal. */
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

/** Session-wide audience Q&A: ask + upvote for the whole session, independent of any interaction. */
export interface SessionQna {
  enabled?: boolean;
  /** Maximum question length in characters. Default 300, hard cap 500. */
  maxLength?: number;
}

/** Interaction slice of an Outline (`toSession`). Not the product Session. */
export interface Session {
  version: 1;
  meta: SessionMeta;
  defaults?: SessionDefaults;
  qna?: SessionQna;
  interactions: Interaction[];
}

/* ------------------------------------------------------------------ */
/* Normalized session (output of normalizeSession): all defaults materialized */
/* ------------------------------------------------------------------ */

export interface NormalizedDefaults {
  identityMode: IdentityMode;
  resultVisibility: ResultVisibility;
  allowAnswerChange: boolean;
  theme: SessionThemeId;
}

export type NormalizedBase<T extends BaseInteraction> = T & {
  resultVisibility: ResultVisibility;
  allowAnswerChange: boolean;
  allowDontKnow: boolean;
  displayOptions: DisplayOptions;
};

export type NormalizedChoiceInteraction = NormalizedBase<ChoiceInteraction> & {
  display: ChoiceDisplay;
  multiple: boolean;
  peerInstruction: boolean;
};
export type NormalizedScaleInteraction = NormalizedBase<ScaleInteraction> & { display: ScaleDisplay };
export type NormalizedNumericInteraction = NormalizedBase<NumericInteraction> & {
  display: NumericDisplay;
};
export type NormalizedTextInteraction = NormalizedBase<TextInteraction> & {
  display: TextDisplay;
  maxLength: number;
};
export type NormalizedQnaInteraction = NormalizedBase<QnaInteraction> & { display: QnaDisplay };
export type NormalizedRankingInteraction = NormalizedBase<RankingInteraction> & {
  display: RankingDisplay;
};
export type NormalizedFillTheGapsInteraction = NormalizedBase<FillTheGapsInteraction> & {
  display: FillTheGapsDisplay;
};
export type NormalizedMatchInteraction = NormalizedBase<MatchInteraction> & {
  display: MatchDisplay;
};

export type NormalizedInteraction =
  | NormalizedChoiceInteraction
  | NormalizedScaleInteraction
  | NormalizedNumericInteraction
  | NormalizedTextInteraction
  | NormalizedQnaInteraction
  | NormalizedRankingInteraction
  | NormalizedFillTheGapsInteraction
  | NormalizedMatchInteraction;

export interface NormalizedQna {
  enabled: boolean;
  maxLength: number;
}

export interface NormalizedSession extends Session {
  defaults: NormalizedDefaults;
  qna: NormalizedQna;
  interactions: NormalizedInteraction[];
}

/* ------------------------------------------------------------------ */
/* Participant-safe projection                                         */
/* ------------------------------------------------------------------ */

/** An interaction with pre-reveal-unsafe fields removed (API-06). */
export type ParticipantOption = Omit<ChoiceOption, 'correct' | 'misconception'>;

export type ParticipantInteraction =
  | (Omit<ChoiceInteraction, 'notes' | 'options' | 'pedagogy'> & { options: ParticipantOption[] })
  | Omit<ScaleInteraction, 'notes' | 'pedagogy'>
  | Omit<NumericInteraction, 'notes' | 'correct' | 'tolerance' | 'pedagogy'>
  | Omit<TextInteraction, 'notes' | 'pedagogy' | 'correctAnswers'>
  | Omit<QnaInteraction, 'notes' | 'pedagogy'>
  | (Omit<RankingInteraction, 'notes' | 'pedagogy' | 'options' | 'correctOrder'> & {
      options: RankingOption[];
    })
  | (Omit<FillTheGapsInteraction, 'notes' | 'pedagogy' | 'gaps' | 'bank'> & {
      gaps: { id: string; options?: string[] }[];
      bankWords?: string[];
    })
  | Omit<MatchInteraction, 'notes' | 'pedagogy' | 'correct'>;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Stable error codes. Never renumber or rename these. */
export const ErrorCodes = {
  /** Input could not be parsed as YAML or JSON. */
  E_PARSE: 'E_PARSE',
  /** JSON Schema validation failure (or a structural constraint without a more specific code). */
  E_SCHEMA: 'E_SCHEMA',
  /**
   * An outline step's `kind` is missing or not one of the named kinds. Reported
   * on its own — the step union cannot be checked at all until `kind` names a
   * branch, so every other error on that step would be noise from branches the
   * author never meant.
   */
  E_UNKNOWN_KIND: 'E_UNKNOWN_KIND',
  /** Duplicate interaction id or duplicate option id. */
  E_DUPLICATE_ID: 'E_DUPLICATE_ID',
  /** `display` value is not allowed for the interaction's type. */
  E_DISPLAY_MISMATCH: 'E_DISPLAY_MISMATCH',
  /** numeric `tolerance` present without `correct`. */
  E_TOLERANCE_WITHOUT_CORRECT: 'E_TOLERANCE_WITHOUT_CORRECT',
  /**
   * choice interaction has fewer than 2 or more than 10 options, or a ranking
   * interaction has fewer than 2 or more than 6.
   */
  E_OPTION_COUNT: 'E_OPTION_COUNT',
  /**
   * `peerInstruction` set on something other than a single-select choice
   * interaction (peer instruction is a vote → discuss → revote cycle over one
   * choice; multi-select and the other types have no revote semantics).
   */
  E_PEER_INSTRUCTION_CONFIG: 'E_PEER_INSTRUCTION_CONFIG',
  /**
   * ranking `correctOrder` is present but is not a complete permutation of the
   * interaction's option ids (wrong length, unknown id, or duplicate).
   */
  E_CORRECT_ORDER: 'E_CORRECT_ORDER',
  /** FillTheGaps prompt placeholders and `gaps` do not match. */
  E_FILL_THE_GAPS_GAPS: 'E_FILL_THE_GAPS_GAPS',
  /**
   * A distractor normalize-equals an accepted answer or another distractor of
   * the same gap.
   */
  E_FILL_THE_GAPS_DISTRACTOR: 'E_FILL_THE_GAPS_DISTRACTOR',
  /**
   * `bank` display with no extra bank words and fewer than two gaps, or the
   * bank list itself has duplicate entries.
   */
  E_FILL_THE_GAPS_BANK: 'E_FILL_THE_GAPS_BANK',
  /** `choices` display while some gap has no distractors. */
  E_FILL_THE_GAPS_CHOICES: 'E_FILL_THE_GAPS_CHOICES',
  /** Match `correct` is not a complete 1:1 map of left ids onto right ids. */
  E_MATCH_PAIRS: 'E_MATCH_PAIRS',
  /** An outline step references an interaction, asset, or breakout parent that is not present. */
  E_UNKNOWN_REFERENCE: 'E_UNKNOWN_REFERENCE',
  /** `layout` names an arrangement the step's kind has no content to fill. */
  E_LAYOUT_MISMATCH: 'E_LAYOUT_MISMATCH',
  /** `reveal` names a part the step does not have, repeats a part, or has an empty group. */
  E_REVEAL: 'E_REVEAL',
  /** `breakoutOf` is more than one level deep, cyclic, or names a part its parent does not have. */
  E_BREAKOUT: 'E_BREAKOUT',
} as const;

export type SessionErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface SessionError {
  code: string;
  /** JSON pointer into the session document, e.g. `/interactions/2/display`. */
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; session: Session }
  | { ok: false; errors: SessionError[] };
