import type { SlideLayout } from './layout';

/** Slide-shape types shared by the skeleton, the projector and the canvas. */

/** Structurally the SDK's `LearnerOutlineStep`; kept local so the package has no type dependency it does not need. */
export interface SlideCard {
  label?: string;
  text: string;
  textSpans?: readonly SlideSpanStyle[];
}

/**
 * Per-line styling for a string list, aligned by index with the list it
 * mirrors. May be shorter than the list; `null` rows are unstyled lines.
 */
export type SlideSpanRows = readonly (readonly SlideSpanStyle[] | null)[];

export interface SlideMedia {
  type: 'image' | 'video' | 'audio';
  listening?: { mode: 'room' | 'individual'; transcript?: string };
  url?: string;
  alt: string;
  caption?: string;
  focal?: string;
  /** Named frame shape (`16:9`, `9:16`, …). Surfaces resolve a default for video. */
  aspect?: string;
  /** Which slot the picture occupies. Surfaces default from the step layout. */
  place?: string;
  /** Share of the slide, 20–100. Width for left/right, height for top/bottom. */
  size?: number;
}

/**
 * The step's own content, before the presentation fields every step carries.
 * Kept separate only so `layout` can be attached once instead of twelve times.
 */
export interface SlideElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideSpanStyle {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Percent of the slide base font, rendered as em so every surface scales alike. */
  size?: number;
  /** Closed token resolved per surface; never a raw CSS family. */
  family?: 'default' | 'display' | 'serif' | 'mono';
  /** #rrggbb only. */
  color?: string;
}

export type SlideElement =
  | {
      id: string;
      type: 'text';
      text: string;
      spans?: readonly SlideSpanStyle[];
      align?: 'left' | 'center' | 'right';
      role?: string;
      box: SlideElementBox;
    }
  | {
      id: string;
      type: 'image';
      url?: string;
      alt: string;
      caption?: string;
      focal?: string;
      box: SlideElementBox;
    }
  | { id: string; type: 'html'; html: string; css?: string; markdown?: string; box: SlideElementBox }
  | { id: string; type: 'iframe'; url: string; title: string; box: SlideElementBox }
  | { id: string; type: 'pdf'; url: string; title: string; box: SlideElementBox };

export type SlideStepContent =
  | {
      id: string;
      kind: 'title';
      title: string;
      body?: string;
      titleSpans?: readonly SlideSpanStyle[];
      bodySpans?: readonly SlideSpanStyle[];
      media?: SlideMedia;
      elements?: readonly SlideElement[];
    }
  | {
      id: string;
      kind: 'statement';
      title?: string;
      body: string;
      stat?: string;
      titleSpans?: readonly SlideSpanStyle[];
      bodySpans?: readonly SlideSpanStyle[];
      statSpans?: readonly SlideSpanStyle[];
      media?: SlideMedia;
      elements?: readonly SlideElement[];
    }
  | {
      id: string;
      kind: 'cards';
      title: string;
      titleSpans?: readonly SlideSpanStyle[];
      items: readonly SlideCard[];
      media?: SlideMedia;
    }
  | {
      id: string;
      kind: 'steps';
      title: string;
      titleSpans?: readonly SlideSpanStyle[];
      items: readonly string[];
      itemsSpans?: SlideSpanRows;
      media?: SlideMedia;
    }
  | {
      id: string;
      kind: 'term';
      term: string;
      meaning: string;
      example?: string;
      termSpans?: readonly SlideSpanStyle[];
      meaningSpans?: readonly SlideSpanStyle[];
      exampleSpans?: readonly SlideSpanStyle[];
      media?: SlideMedia;
    }
  | {
      id: string;
      kind: 'activity';
      title: string;
      titleSpans?: readonly SlideSpanStyle[];
      instructions: readonly string[];
      instructionsSpans?: SlideSpanRows;
      materials?: readonly string[];
      materialsSpans?: SlideSpanRows;
      /** An optional picture beside the instructions — the `image` part. */
      media?: SlideMedia;
      durationSec?: number;
    }
  | {
      id: string;
      kind: 'timer';
      title?: string;
      body?: string;
      seconds: number;
      /** How the clock is drawn. Default countdown. */
      style?: string;
    }
  | {
      id: string;
      kind: 'media';
      title?: string;
      titleSpans?: readonly SlideSpanStyle[];
      media: SlideMedia;
      elements?: readonly SlideElement[];
    }
  | {
      id: string;
      kind: 'debrief';
      title: string;
      titleSpans?: readonly SlideSpanStyle[];
      prompts: readonly string[];
      promptsSpans?: SlideSpanRows;
      media?: SlideMedia;
    }
  | {
      id: string;
      kind: 'break';
      title: string;
      body?: string;
      titleSpans?: readonly SlideSpanStyle[];
      bodySpans?: readonly SlideSpanStyle[];
      minutes?: number;
    }
  | { id: string; kind: 'join' }
  | {
      id: string;
      kind: 'blank';
      title?: string;
      titleSpans?: readonly SlideSpanStyle[];
      elements?: readonly SlideElement[];
    }
  | {
      id: string;
      kind: 'interaction';
      interactionId: string;
      title?: string;
      body?: string;
      titleSpans?: readonly SlideSpanStyle[];
      bodySpans?: readonly SlideSpanStyle[];
      media?: SlideMedia;
    };

/** What a join slide encodes. Omitted in the deck editor — the skeleton draws a sample. */
export interface SlideJoin {
  url: string;
  code: string;
}

/** Placeholder so the author sees the finished slide before a session exists. */
const SAMPLE_JOIN: SlideJoin = { url: 'https://join.openroom.app/', code: 'ABCD1234' };

/**
 * A step as this renderer sees it: its content, plus the optional `layout` every
 * step carries (`OutlineStepBase.layout`). Intersecting rather than repeating
 * the field keeps `step.kind` narrowing intact.
 */
export type SlideStep = SlideStepContent & { layout?: SlideLayout };

export interface SlideOption {
  id: string;
  label: string;
  labelSpans?: readonly SlideSpanStyle[];
}
