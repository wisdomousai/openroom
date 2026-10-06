import {
  stepElements,
  type Outline,
  type OutlineElement,
  type OutlineElementBox,
} from '@openroom/schema';
import { clampBox } from './media-elements';
import { keepValid, replaceStep } from './blocks';

/**
 * Structural edits on a parsed `Outline` — layout presets for a freeform
 * composition slide.
 *
 * A wired kind picks a `layout` and the skin does the rest; a `blank` slide has
 * only `blank` to pick, because its geometry *is* its elements. So converting a
 * composition between arrangements is not a stored field — it is a one-shot
 * re-box of the elements already on the slide, undone like any other edit.
 *
 * The elements stay the source of truth: nothing about the chosen preset is
 * written down, and only `box` is touched. Alignment, roles and spans are the
 * author's.
 */

/** The three roles a preset can place. Everything else on the slide is left alone. */
interface LayoutSlots {
  heading?: OutlineElementBox;
  body?: OutlineElementBox;
  media?: OutlineElementBox;
}

export interface ElementLayout {
  id: string;
  label: string;
  slots: LayoutSlots;
}

/**
 * The presets, matching the geometry the freeform starters are born with —
 * so "Title" inserted and then re-picked lands back exactly where it started.
 */
export const ELEMENT_LAYOUTS: readonly ElementLayout[] = [
  {
    id: 'centered',
    label: 'Centered',
    slots: {
      heading: { x: 10, y: 32, w: 80, h: 16 },
      body: { x: 14, y: 52, w: 72, h: 10 },
    },
  },
  {
    id: 'headline',
    label: 'Headline',
    slots: {
      heading: { x: 8, y: 28, w: 84, h: 16 },
      body: { x: 8, y: 48, w: 84, h: 24 },
    },
  },
  {
    id: 'split',
    label: 'Split',
    slots: {
      heading: { x: 8, y: 18, w: 38, h: 20 },
      body: { x: 8, y: 42, w: 38, h: 35 },
      media: { x: 54, y: 15, w: 38, h: 70 },
    },
  },
  {
    id: 'media-full',
    label: 'Picture over caption',
    slots: {
      media: { x: 8, y: 15, w: 84, h: 57 },
      heading: { x: 8, y: 75, w: 84, h: 10 },
    },
  },
];

/**
 * The layouts this step can be re-boxed into, or none.
 *
 * Only a `blank` slide with elements on it: a wired kind already has
 * `LAYOUTS_FOR_KIND`, and an empty canvas has nothing to arrange.
 */
export function elementLayoutsFor(step: { kind: string } & object): readonly ElementLayout[] {
  const elements = stepElements(step as Parameters<typeof stepElements>[0]);
  if (step.kind !== 'blank' || elements.length === 0) return [];
  return ELEMENT_LAYOUTS;
}

/** True when this element is the picture-shaped one a media slot wants. */
function isMediaElement(element: OutlineElement): boolean {
  return element.type === 'image' || element.type === 'pdf' || element.type === 'iframe';
}

/**
 * Re-box a composition's elements into one preset.
 *
 * Assignment is positional and deterministic: the first heading-role text box
 * takes the heading slot, the first picture-shaped object takes the media slot,
 * the first remaining text box takes the body slot. A slot with no element to
 * fill it is skipped rather than inventing one, and everything past the first
 * of each role keeps the box the author gave it.
 */
export function applyElementLayout(outline: Outline, stepId: string, layoutId: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const layout = ELEMENT_LAYOUTS.find((item) => item.id === layoutId);
  if (layout === undefined || elementLayoutsFor(step).length === 0) return outline;

  const elements = stepElements(step);
  const heading = elements.find((item) => item.type === 'text' && item.role === 'heading');
  const media = elements.find(isMediaElement);
  const body = elements.find((item) => item.type === 'text' && item !== heading);

  const boxes = new Map<string, OutlineElementBox>();
  if (heading !== undefined && layout.slots.heading !== undefined) {
    boxes.set(heading.id, clampBox(layout.slots.heading));
  }
  if (body !== undefined && layout.slots.body !== undefined) {
    boxes.set(body.id, clampBox(layout.slots.body));
  }
  if (media !== undefined && layout.slots.media !== undefined) {
    boxes.set(media.id, clampBox(layout.slots.media));
  }
  if (boxes.size === 0) return outline;

  const next = elements.map((item) => {
    const box = boxes.get(item.id);
    return box === undefined ? item : { ...item, box };
  });
  return keepValid(
    outline,
    replaceStep(outline, stepId, { ...step, elements: next } as typeof step),
  );
}
