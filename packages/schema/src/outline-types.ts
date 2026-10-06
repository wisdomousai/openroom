import type { SessionDefaults, SessionError, SessionQna, Interaction, Session } from './types.js';
import type { DeckDesign, SlideDesign } from './deck-design.js';

export interface OutlineProvenance {
  label: string;
  note?: string;
}

export interface OutlineMeta {
  title: string;
  description?: string;
  locale?: string;
  source?: string;
  subject?: string;
  language?: string;
  level?: string;
  durationMinutes?: number;
  objectives?: string[];
  /** Labels only. Original source documents remain in the external preparation agent. */
  provenance?: OutlineProvenance[];
}

/**
 * A typed arrangement of regions — never CSS, coordinates, or presentation code.
 * OpenRoom still chooses the pixels. `LAYOUTS_FOR_KIND` (outline-parts.ts) says
 * which layouts a given step kind can fill.
 */
export type OutlineLayout =
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

/**
 * How the step's parts appear: all at once, or in ordered groups of part keys.
 * Part keys are derived from the step's own shape — see `partKeysForStep`.
 * Parts the author does not place are revealed last, one group each.
 */
export type OutlineReveal = 'together' | string[][];

/**
 * Attaches this step to one part of another step as an on-demand detail: the
 * tutor opens it from that part and returns to the parent afterwards. One level
 * only — a breakout cannot itself have a breakout.
 */
export interface OutlineBreakoutOf {
  /** Id of the parent step. Must not be a breakout itself. */
  stepId: string;
  /** A part key of the parent step. */
  afterKey: string;
}

export interface OutlineStepBase {
  id: string;
  kind: OutlineStepKind;
  layout?: OutlineLayout;
  reveal?: OutlineReveal;
  breakoutOf?: OutlineBreakoutOf;
  design?: SlideDesign;
  /** Tutor-only. Removed from learner and stage projections. */
  tutorNotes?: string;
}

/**
 * Every step kind, in the order the schema's `$defs.step` oneOf declares them.
 * The type is derived from the `OutlineStep` union below, so adding a step
 * without listing it here fails to compile — which keeps the one runtime list
 * an agent-facing error message can name from drifting off the contract.
 */
export const OUTLINE_STEP_KINDS = [
  'title',
  'statement',
  'cards',
  'steps',
  'term',
  'activity',
  'timer',
  'media',
  'debrief',
  'break',
  'join',
  'blank',
  'interaction',
] as const satisfies readonly OutlineStepKind[];

/**
 * `satisfies` proves every listed kind is real; this proves none is missing.
 * A new member of the `OutlineStep` union left out of the list above stops
 * assigning to `true` here.
 */
const _outlineStepKindsExhaustive: OutlineStepKind extends (typeof OUTLINE_STEP_KINDS)[number]
  ? true
  : never = true;
void _outlineStepKindsExhaustive;

/** Title, statement, media, and blank may carry extra boxed objects. Wired kinds may not. */
export const FREEFORM_STEP_KINDS = ['title', 'statement', 'media', 'blank'] as const;
export type FreeformStepKind = (typeof FREEFORM_STEP_KINDS)[number];

export const ELEMENT_MAX = 12;
export const ELEMENT_MARKUP_MAX = 32_768;
/**
 * Reading material is far longer than a hand-written fragment, so a markdown
 * source gets its own budget. The html rendered from it is derived, not authored,
 * and is bounded by `ELEMENT_HTML_ABS_MAX` instead of `ELEMENT_MARKUP_MAX`.
 */
export const ELEMENT_MARKDOWN_MAX = 65_536;
/** Structural ceiling on any stored html/css string, authored or derived. */
export const ELEMENT_HTML_ABS_MAX = 131_072;
export const ELEMENT_BOX_MIN = 8;
export const ELEMENT_BOX_MAX = 100;

/**
 * Span font size, in percent of the slide's base font size. Scale-free on
 * purpose: the slide root is sized by the surface (desk, wall, phone), so a
 * stored `150` renders as 1.5em everywhere and never drifts between them.
 */
export const SPAN_SIZE_MIN = 25;
export const SPAN_SIZE_MAX = 400;
/** Span color. Hex only — no names, no rgb(), nothing that can smuggle CSS. */
export const SPAN_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const TEXT_ELEMENT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextElementAlignment = (typeof TEXT_ELEMENT_ALIGNMENTS)[number];
export const SPAN_FONT_FAMILIES = ['default', 'display', 'serif', 'mono'] as const;
export type SpanFontFamily = (typeof SPAN_FONT_FAMILIES)[number];

/** One styled span inside a text element. Concatenation must equal `text`. */
export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Percent of the slide base font, 25–400. Default when omitted: 100. */
  size?: number;
  /** Closed token set resolved to a theme font per surface — never raw CSS families. */
  family?: SpanFontFamily;
  /** #rrggbb only. */
  color?: string;
}

/** Percent box on the authored slide aspect ratio. Integers, origin top-left. */
export interface OutlineElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OutlineElementRole = 'heading' | 'body';

export interface OutlineTextElement {
  id: string;
  type: 'text';
  text: string;
  /**
   * Styled spans over `text`, authoritative when present (the same precedence
   * html/markdown carry). Must concatenate exactly to `text`; agents may keep
   * authoring plain `text` and omit this entirely.
   */
  spans?: TextSpan[];
  /** Element-level alignment. Spans carry their own weight/color/size. */
  align?: TextElementAlignment;
  role?: OutlineElementRole;
  box: OutlineElementBox;
}

export interface OutlineImageElement {
  id: string;
  type: 'image';
  url?: string;
  assetId?: string;
  /** Resource embedded in the teacher-owned .openroom package. */
  resourceId?: string;
  alt: string;
  caption?: string;
  focal?: OutlineMediaFocal;
  box: OutlineElementBox;
}

export interface OutlineHtmlElement {
  id: string;
  type: 'html';
  html: string;
  css?: string;
  /**
   * Markdown source for reading-material elements. When present it is
   * authoritative and `html` is its rendered form — every writer must set the
   * two together via `renderMarkdownToHtml`, and validation rejects a pair that
   * has drifted apart.
   */
  markdown?: string;
  box: OutlineElementBox;
}

/** A sandboxed external web page. The source site may still refuse to be framed. */
export interface OutlineIframeElement {
  id: string;
  type: 'iframe';
  url: string;
  title: string;
  box: OutlineElementBox;
}

/** A PDF document shown in the browser's scrollable PDF viewer. */
export interface OutlinePdfElement {
  id: string;
  type: 'pdf';
  url?: string;
  /** Retained OpenRoom/R2 asset used by a synced deck. */
  assetId?: string;
  /** Resource embedded in the teacher-owned .openroom package. */
  resourceId?: string;
  title: string;
  box: OutlineElementBox;
}

export type OutlineElement =
  | OutlineTextElement
  | OutlineImageElement
  | OutlineHtmlElement
  | OutlineIframeElement
  | OutlinePdfElement;

export interface OutlineTitleStep extends OutlineStepBase {
  kind: 'title';
  title: string;
  body?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  /** Styled spans over `body`. Concatenation must equal it. */
  bodySpans?: TextSpan[];
  /** Optional picture beside or under the title. Same shape a media step carries. */
  media?: OutlineMedia;
  /** Extra objects on this slide. Not allowed on wired kinds. */
  elements?: OutlineElement[];
}

export interface OutlineStatementStep extends OutlineStepBase {
  kind: 'statement';
  title?: string;
  body: string;
  stat?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  /** Styled spans over `body`. Concatenation must equal it. */
  bodySpans?: TextSpan[];
  /** Styled spans over `stat`. Concatenation must equal it. */
  statSpans?: TextSpan[];
  /** Optional picture beside the claim. Same shape a media step carries. */
  media?: OutlineMedia;
  elements?: OutlineElement[];
}

export interface OutlineCard {
  label?: string;
  text: string;
  /** Styled spans over `text`. Concatenation must equal it. */
  textSpans?: TextSpan[];
  imageAssetId?: string;
  /** Pair-work split: 0 or 1. Omitted items are shared. */
  lane?: 0 | 1;
}

/**
 * Styled spans over a list of plain strings, aligned by index. A `null` entry is
 * an unstyled line; the array may be shorter than the list it mirrors, never
 * longer. Each non-null entry must concatenate to its line.
 */
export type SpanRows = (TextSpan[] | null)[];

export interface OutlineCardsStep extends OutlineStepBase {
  kind: 'cards';
  title: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  items: OutlineCard[];
  /** Optional picture with the heading. The cards themselves stay a grid. */
  media?: OutlineMedia;
}

export interface OutlineStepsStep extends OutlineStepBase {
  kind: 'steps';
  title: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  items: string[];
  /** Styled spans over `items`, aligned by index. */
  itemsSpans?: SpanRows;
  /** Optional picture with the heading. The list stays the supporting region. */
  media?: OutlineMedia;
}

export interface OutlineTermStep extends OutlineStepBase {
  kind: 'term';
  term: string;
  meaning: string;
  /** Styled spans over `term`. Concatenation must equal it. */
  termSpans?: TextSpan[];
  /** Styled spans over `meaning`. Concatenation must equal it. */
  meaningSpans?: TextSpan[];
  example?: string;
  /** Styled spans over `example`. Concatenation must equal it. */
  exampleSpans?: TextSpan[];
  /** Optional picture beside the term. Same shape a media step carries. */
  media?: OutlineMedia;
}

export interface OutlineActivityStep extends OutlineStepBase {
  kind: 'activity';
  title: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  /** What the learners do. */
  instructions: string[];
  /** Styled spans over `instructions`, aligned by index. */
  instructionsSpans?: SpanRows;
  /** What the learners need in front of them. Not steps — things. */
  materials?: string[];
  /** Styled spans over `materials`, aligned by index. */
  materialsSpans?: SpanRows;
  /**
   * An optional picture beside the instructions — the thing being built, the
   * board being filled in. The same `OutlineMedia` a media step carries, so
   * there is one description of a picture in the contract rather than two.
   */
  media?: OutlineMedia;
  durationSec?: number;
}

/**
 * How a timer step is drawn on the slide. Closed enum — never free CSS.
 * Default when omitted: `countdown` (digital mm:ss counting down).
 */
export type OutlineTimerStyle =
  | 'countdown'
  | 'countup'
  | 'bar-empty'
  | 'bar-fill'
  | 'hourglass'
  | 'ring';

export const TIMER_STYLES = [
  'countdown',
  'countup',
  'bar-empty',
  'bar-fill',
  'hourglass',
  'ring',
] as const satisfies readonly OutlineTimerStyle[];

/**
 * Where a timer step is drawn. Default when omitted: `slide`.
 * `corner` is a pill on the current slide; `slide` is a full-slide clock.
 */
export type OutlineTimerPlacement = 'slide' | 'corner';

export const TIMER_PLACEMENTS = ['slide', 'corner'] as const satisfies readonly OutlineTimerPlacement[];

export interface OutlineTimerStep extends OutlineStepBase {
  kind: 'timer';
  title?: string;
  body?: string;
  seconds: number;
  /** Visual representation of the clock. Default countdown. */
  style?: OutlineTimerStyle;
  /** Where the clock is drawn. Default `slide`. */
  placement?: OutlineTimerPlacement;
  /**
   * Keep the clock in the corner when the teacher moves on.
   * Default `true`. The live clock itself is session state, not this field.
   */
  persist?: boolean;
}

/** Which part of the frame to keep when the media region crops. Nine named points, no coordinates. */
export type OutlineMediaFocal =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

/**
 * Named frame shape for a picture or video. Closed enum — never free numbers or CSS.
 * Orientation follows: 16:9 and 4:3 are landscape, 9:16 portrait, 1:1 square.
 * Video defaults to 16:9 when omitted (or 9:16 when the URL is a YouTube Short).
 */
export type OutlineMediaAspect = '16:9' | '9:16' | '4:3' | '1:1';

/**
 * Where a picture sits on the slide. A named slot, not a coordinate.
 * Surfaces resolve a default from the step's layout when this is omitted.
 */
export type OutlineMediaPlace = 'left' | 'right' | 'top' | 'bottom' | 'fill';

export const MEDIA_PLACES = ['left', 'right', 'top', 'bottom', 'fill'] as const satisfies readonly OutlineMediaPlace[];

/** Picture share of the slide, in whole percent. */
export const MEDIA_SIZE_MIN = 20;
export const MEDIA_SIZE_MAX = 100;
/** Layout default when the author has not sized the picture. */
export const MEDIA_SIZE_DEFAULT = 42;

export interface OutlineMedia {
  type: 'image' | 'video' | 'audio';
  assetId?: string;
  url?: string;
  /** Resource embedded in the teacher-owned .openroom package. */
  resourceId?: string;
  alt: string;
  caption?: string;
  /** Required for audio. The transcript is withheld from audience projections until revealed. */
  listening?: { mode: 'room' | 'individual'; transcript?: string };
  focal?: OutlineMediaFocal;
  /** Frame the player / picture keeps. Optional; surfaces resolve a default for video. */
  aspect?: OutlineMediaAspect;
  /** Which slot the picture occupies. Default follows the step layout. */
  place?: OutlineMediaPlace;
  /**
   * How much of the slide the picture takes, 20–100.
   * Width for left/right, height for top/bottom. Ignored when `place` is `fill`.
   */
  size?: number;
}

export interface OutlineMediaStep extends OutlineStepBase {
  kind: 'media';
  title?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  media: OutlineMedia;
  elements?: OutlineElement[];
}

export interface OutlineDebriefStep extends OutlineStepBase {
  kind: 'debrief';
  title: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  prompts: string[];
  /** Styled spans over `prompts`, aligned by index. */
  promptsSpans?: SpanRows;
  /** Optional picture with the heading. The prompts stay the list. */
  media?: OutlineMedia;
}

export interface OutlineBreakStep extends OutlineStepBase {
  kind: 'break';
  title: string;
  body?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  /** Styled spans over `body`. Concatenation must equal it. */
  bodySpans?: TextSpan[];
  minutes?: number;
}

/**
 * Full-slide QR for joining the live session. No authored fields — the URL and
 * code come from the session, not the file.
 */
export interface OutlineJoinStep extends OutlineStepBase {
  kind: 'join';
}

/**
 * A freeform canvas slide: optionally a title, otherwise only the boxed
 * elements the author places. The PowerPoint "Blank" / "Title Only" layouts.
 */
export interface OutlineBlankStep extends OutlineStepBase {
  kind: 'blank';
  title?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  elements?: OutlineElement[];
}

export interface OutlineInteractionStep extends OutlineStepBase {
  kind: 'interaction';
  interactionId: string;
  title?: string;
  body?: string;
  /** Styled spans over `title`. Concatenation must equal it. */
  titleSpans?: TextSpan[];
  /** Styled spans over `body`. Concatenation must equal it. */
  bodySpans?: TextSpan[];
  /** Optional picture with the prompt. Options stay the supporting region. */
  media?: OutlineMedia;
}

export type OutlineStep =
  | OutlineTitleStep
  | OutlineStatementStep
  | OutlineCardsStep
  | OutlineStepsStep
  | OutlineTermStep
  | OutlineActivityStep
  | OutlineTimerStep
  | OutlineMediaStep
  | OutlineDebriefStep
  | OutlineBreakStep
  | OutlineJoinStep
  | OutlineBlankStep
  | OutlineInteractionStep;

export type OutlineStepKind = OutlineStep['kind'];

/** Omit that distributes over a union so kind-specific fields survive. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type LearnerOutlineStep = DistributiveOmit<OutlineStep, 'tutorNotes'>;

/**
 * Homework or recap — a page that travels with the file, not a slide.
 * Never enters the running order. Title plus prose, a list, or both.
 * Homework may also carry typed `tasks` the student can do.
 */
export type HomeworkTaskKind = 'reading' | 'writing' | 'voice' | 'quiz';

export interface HomeworkReadingTask {
  id: string;
  kind: 'reading';
  title?: string;
  body: string;
}

export interface HomeworkWritingTask {
  id: string;
  kind: 'writing';
  title?: string;
  prompt: string;
  guidance?: string;
}

export interface HomeworkQuizTask {
  id: string;
  kind: 'quiz';
  title?: string;
  interactionId: string;
}

export interface HomeworkVoiceTask {
  id: string;
  kind: 'voice';
  title?: string;
  prompt: string;
  guidance?: string;
}

export type HomeworkTask = HomeworkReadingTask | HomeworkWritingTask | HomeworkVoiceTask | HomeworkQuizTask;

export interface OutlineAside {
  title?: string;
  body?: string;
  items?: string[];
  /** Homework only. Recap must not carry tasks. */
  tasks?: HomeworkTask[];
}

export interface Outline {
  version: 1;
  meta: OutlineMeta;
  design?: DeckDesign;
  defaults?: SessionDefaults;
  qna?: SessionQna;
  steps: OutlineStep[];
  interactions: Interaction[];
  /** Not a slide. One page that goes to the student with the file. */
  homework?: OutlineAside;
  /** Not a slide. One page drafted from the session, stored on the file. */
  recap?: OutlineAside;
}

export type OutlineValidateResult =
  | { ok: true; outline: Outline; session: Session }
  | { ok: false; errors: SessionError[] };

export interface CompiledOutline {
  outline: Outline;
  session: Session;
}
