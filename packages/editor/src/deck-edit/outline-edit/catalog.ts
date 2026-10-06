import type { Outline, OutlineStep } from '@openroom/schema';

/**
 * Structural edits on a parsed `Outline` — insert catalog and starters.
 *
 * The deck editor edits the object, not the text: the YAML is re-serialised from
 * the result, so the plan file and the structure view can never drift.
 */

/**
 * Typed blocks the Insert tab / block context menu can add after the selected one.
 *
 * Covers every outline step kind. Some inserts are *presets* of the same kind
 * (`image` / `video` / `media-full` → `media`; `boxes` → `cards`; `block` →
 * `statement`). Audience-interactive content is always `question` →
 * `interaction`; poll type is chosen in Properties.
 *
 * Breakout is not a kind — any of these can be filed as a breakout (detail that
 * opens from a part of the parent and returns to it). The context menu offers
 * the same catalog under **Breakout →**.
 */
/**
 * Typed blocks the Insert tab / block context menu can add after the selected one.
 *
 * Covers every outline step kind. Some inserts are *presets* of the same kind
 * (`image` / `video` / `media-full` → `media`; `boxes` → `cards`; `block` →
 * `statement`). Audience-interactive content is always `question` →
 * `interaction`; poll type is chosen in Properties.
 *
 * Breakout is not a kind — any of these can be filed as a breakout (detail that
 * opens from a part of the parent and returns to it). The context menu offers
 * the same catalog under **Breakout →**.
 */
export const INSERT_KINDS = [
  'block',
  'title',
  'statement',
  'cards',
  'boxes',
  'steps',
  'term',
  'activity',
  'timer',
  'media',
  'image',
  'video',
  'audio',
  'media-full',
  'debrief',
  'break',
  'join',
  'blank',
  'blank-titled',
  'question',
  'fill-the-gaps',
  'match',
] as const;
export type InsertKind = (typeof INSERT_KINDS)[number];

/**
 * How an insert instantiates.
 *
 * `freeform` — the starter is boxed elements the author drags, resizes and
 * formats. `wired` — the starter fills a step kind's automatic layout, and the
 * skin owns the geometry.
 *
 * `kindCanCarryElements` is the capability gate and cannot express this split:
 * `video` maps onto the freeform-capable `media` kind yet stays wired, because
 * the wired media slot owns the aspect frame, the embed resolution and the
 * pending-URL placeholder.
 */
export type InsertStarter = 'freeform' | 'wired';

export type InsertItem = { kind: InsertKind; label: string; starter: InsertStarter };
export type InsertGroup = { group: string; items: InsertItem[] };

/**
 * Short list for the block context menu root — common classroom inserts.
 * Everything else lives under **More →** (and **Breakout →** uses the full catalog).
 */
export const INSERT_TOP: InsertItem[] = [
  { kind: 'title', label: 'Title', starter: 'freeform' },
  { kind: 'cards', label: 'Cards', starter: 'wired' },
  { kind: 'term', label: 'Term', starter: 'wired' },
  { kind: 'question', label: 'Question', starter: 'wired' },
  { kind: 'join', label: 'Join the session', starter: 'wired' },
  { kind: 'fill-the-gaps', label: 'Fill the gaps', starter: 'wired' },
];

/** Full insert catalog, grouped. Shared by More →, Breakout →, and the Insert ribbon. */
export const INSERT_CATALOG: InsertGroup[] = [
  {
    group: 'Content',
    items: [
      { kind: 'title', label: 'Title', starter: 'freeform' },
      { kind: 'statement', label: 'Statement', starter: 'freeform' },
      { kind: 'blank', label: 'Empty', starter: 'freeform' },
      { kind: 'blank-titled', label: 'Empty + title', starter: 'freeform' },
      { kind: 'cards', label: 'Cards', starter: 'wired' },
      { kind: 'steps', label: 'Steps', starter: 'wired' },
      { kind: 'term', label: 'Term', starter: 'wired' },
    ],
  },
  {
    group: 'Media',
    items: [
      { kind: 'image', label: 'Image + text', starter: 'freeform' },
      { kind: 'video', label: 'Video', starter: 'wired' },
      { kind: 'audio', label: 'Audio', starter: 'wired' },
      { kind: 'media-full', label: 'Full-bleed', starter: 'wired' },
    ],
  },
  {
    group: 'Questions',
    items: [
      { kind: 'question', label: 'Question', starter: 'wired' },
      { kind: 'fill-the-gaps', label: 'Fill the gaps', starter: 'wired' },
      { kind: 'match', label: 'Match', starter: 'wired' },
    ],
  },
  {
    group: 'Classroom',
    items: [
      { kind: 'activity', label: 'Activity', starter: 'wired' },
      { kind: 'timer', label: 'Timer', starter: 'wired' },
      { kind: 'join', label: 'Join the session', starter: 'wired' },
      { kind: 'debrief', label: 'Debrief', starter: 'wired' },
      { kind: 'break', label: 'Break', starter: 'wired' },
    ],
  },
];

/** Lists a block can grow or shrink by one, named by what one entry *is*. */
export const LIST_TARGETS = ['option', 'card', 'material', 'instruction', 'prompt', 'gap'] as const;
export type ListTarget = (typeof LIST_TARGETS)[number];

/**
 * The starter content of a new block.
 *
 * Freeform inserts (see `InsertStarter`) come out as `blank` steps carrying
 * boxed elements: the author drags, resizes and formats them like any other
 * object. `blank` is the only kind whose text is entirely element-borne — the
 * wired kinds require their own slots to be filled, so an elements-only
 * `title` step is not a thing the contract can express.
 */
export function starterStep(kind: InsertKind, id: string): OutlineStep {
  switch (kind) {
    case 'title':
      return {
        id,
        kind: 'blank',
        elements: [
          {
            id: 'head',
            type: 'text',
            role: 'heading',
            align: 'center',
            text: '',
            box: { x: 10, y: 32, w: 80, h: 16 },
          },
          {
            id: 'body',
            type: 'text',
            align: 'center',
            text: '',
            box: { x: 14, y: 52, w: 72, h: 10 },
          },
        ],
      };
    case 'statement':
    case 'block':
      return {
        id,
        kind: 'blank',
        elements: [
          {
            id: 'head',
            type: 'text',
            role: 'heading',
            text: '',
            box: { x: 8, y: 28, w: 84, h: 16 },
          },
          {
            id: 'body',
            type: 'text',
            text: '',
            box: { x: 8, y: 48, w: 84, h: 24 },
          },
        ],
      };
    case 'cards':
    case 'boxes':
      return {
        id,
        kind: 'cards',
        title: '',
        layout: 'grid',
        items: [
          { text: '' },
          { text: '' },
          { text: '' },
          { text: '' },
        ],
      };
    case 'steps':
      return {
        id,
        kind: 'steps',
        title: '',
        items: ['', '', ''],
      };
    case 'term':
      return {
        id,
        kind: 'term',
        term: '',
        meaning: '',
        example: '',
      };
    case 'question':
    case 'fill-the-gaps':
    case 'match':
      // The interaction itself is added alongside in `insertAfter`.
      return { id, kind: 'interaction', interactionId: `${id}-question` };
    case 'activity':
      return {
        id,
        kind: 'activity',
        title: '',
        instructions: ['', ''],
        materials: ['', ''],
        durationSec: 600,
      };
    case 'timer':
      // Length lives in seconds; the author supplies any heading or coaching copy.
      return {
        id,
        kind: 'timer',
        title: '',
        body: '',
        seconds: 600,
      };
    case 'media':
    case 'image':
      // Split geometry by hand: words on the left, picture on the right. The
      // image element carries no url, so it renders its alt as a placeholder
      // until a double-click swaps a real picture in.
      return {
        id,
        kind: 'blank',
        elements: [
          {
            id: 'head',
            type: 'text',
            role: 'heading',
            text: '',
            box: { x: 8, y: 18, w: 38, h: 20 },
          },
          {
            id: 'body',
            type: 'text',
            text: '',
            box: { x: 8, y: 42, w: 38, h: 35 },
          },
          {
            id: 'pic',
            type: 'image',
            alt: '',
            box: { x: 54, y: 15, w: 38, h: 70 },
          },
        ],
      };
    case 'audio':
      return {
        id,
        kind: 'media',
        title: '',
        layout: 'media',
        media: {
          type: 'audio',
          url: 'https://local.openroom.invalid/openroom-pending-audio',
          listening: { mode: 'room' },
          alt: '',
        },
      };
    case 'video':
      // Schema requires url or assetId. Sentinel YouTube URL → placeholder until linked.
      return {
        id,
        kind: 'media',
        title: '',
        layout: 'split',
        media: {
          type: 'video',
          url: 'https://www.youtube.com/watch?v=openroom-pending',
          alt: '',
        },
      };
    case 'media-full':
      return {
        id,
        kind: 'media',
        title: '',
        layout: 'media',
        media: {
          type: 'image',
          url: 'https://example.org/replace-this-image.png',
          alt: '',
        },
      };
    case 'debrief':
      return {
        id,
        kind: 'debrief',
        title: '',
        prompts: ['', '', ''],
      };
    case 'break':
      return {
        id,
        kind: 'break',
        title: '',
        body: '',
        minutes: 5,
      };
    case 'join':
      return { id, kind: 'join' };
    case 'blank':
      return { id, kind: 'blank' };
    case 'blank-titled':
      return { id, kind: 'blank', title: '' };
  }
}

/** The id stem an inserted block is named after. */
export function insertIdBase(kind: InsertKind): string {
  if (kind === 'blank' || kind === 'blank-titled') return 'blank';
  if (kind === 'block' || kind === 'statement') return 'block';
  if (kind === 'media-full' || kind === 'image' || kind === 'media' || kind === 'audio') return 'media';
  if (kind === 'boxes' || kind === 'cards') return 'cards';
  if (kind === 'question') return 'question';
  return kind;
}
