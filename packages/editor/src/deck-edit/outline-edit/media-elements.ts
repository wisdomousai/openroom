import {
  ELEMENT_BOX_MAX,
  LAYOUTS_FOR_KIND,
  MEDIA_SIZE_DEFAULT,
  renderMarkdownToHtml,
  ELEMENT_BOX_MIN,
  ELEMENT_MAX,
  TEXT_ELEMENT_ALIGNMENTS,
  clampMediaSize,
  kindCanCarryElements,
  kindCanCarryPicture,
  layoutForMediaPlace,
  stepElements,
  stepPicture,
  validateOutline,
  type Outline,
  type OutlineElement,
  type OutlineElementBox,
  type OutlineHtmlElement,
  type OutlineIframeElement,
  type OutlineImageElement,
  type OutlineLayout,
  type OutlineMedia,
  type OutlineMediaAspect,
  type OutlineMediaFocal,
  type OutlineMediaPlace,
  type OutlinePdfElement,
  type OutlineStep,
  type TextElementAlignment,
  type TextSpan,
} from '@openroom/schema';
import { keepValid, removeStep, replaceStep } from './blocks';
import { clampSpanSize, clearStyleRange, normalizeSpans, retargetSpans, styleRange } from '../spans';

/**
 * Structural edits on a parsed `Outline` — pictures and elements: set or clear
 * a block's picture (with focal point / aspect / place / size) and add, edit
 * or remove freeform elements.
 */

/**
 * Layouts that already give a picture a region of its own. Adding a picture
 * to a slide that is still on a words-only layout switches it to `split` so
 * the photo lands beside the words instead of waiting for a second click.
 */
const PICTURE_LAYOUTS = new Set<OutlineLayout>(['split', 'media', 'activity']);

function layoutForNewPicture(step: OutlineStep): OutlineLayout | undefined {
  const current = step.layout;
  if (current !== undefined && PICTURE_LAYOUTS.has(current)) return current;
  const allowed = LAYOUTS_FOR_KIND[step.kind];
  const fallback = allowed[0];
  if (current === undefined && fallback !== undefined && PICTURE_LAYOUTS.has(fallback)) {
    return current;
  }
  if (allowed.includes('split')) return 'split';
  return current;
}

/**
 * Put a picture on this slide. `alt` is required by the contract, so the
 * picture dialog asks for it rather than writing an empty one.
 *
 * A media step *is* its picture. Every other kind that can carry one keeps
 * its own words and gains an `image` part. Kinds that cannot (timer, join,
 * break) are left alone — inserting a picture slide is a different verb.
 */
export function setMedia(outline: Outline, stepId: string, media: OutlineMedia): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryPicture(step.kind)) return outline;
  const layout = layoutForNewPicture(step);
  const next = { ...step, media } as OutlineStep;
  if (layout !== step.layout) {
    if (layout === undefined) delete next.layout;
    else next.layout = layout;
  }
  return replaceStep(outline, stepId, next);
}

/** The picture a block currently carries, whichever kind is carrying it. */
export function stepMedia(step: OutlineStep): OutlineMedia | undefined {
  return stepPicture(step);
}

/**
 * Take the picture off a block that can do without one.
 *
 * A media block *is* its picture — removing it would leave a block with
 * nothing in it — so the block goes. Every other kind just loses the region.
 */
export function removeMedia(outline: Outline, stepId: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (step.kind === 'media') return removeStep(outline, stepId);
  if (!kindCanCarryPicture(step.kind) || stepPicture(step) === undefined) return outline;
  const next = { ...step };
  delete (next as { media?: OutlineMedia }).media;
  return replaceStep(outline, stepId, next as OutlineStep);
}

/**
 * The same media with a different focal point (or none).
 *
 * Split out from `setMediaFocal` so the media panel, which edits a draft
 * `OutlineMedia` before it is committed to a step, and the outline-level door
 * below cannot drift on what "no focal point" means.
 */
export function withMediaFocal(
  media: OutlineMedia,
  focal: OutlineMediaFocal | undefined,
): OutlineMedia {
  const next = { ...media };
  if (focal === undefined) delete next.focal;
  else next.focal = focal;
  return next;
}

/** Which part of the frame survives the crop. Nine named points, no coordinates. */
export function setMediaFocal(
  outline: Outline,
  stepId: string,
  focal: OutlineMediaFocal | undefined,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const media = stepMedia(step);
  if (media === undefined) return outline;
  return replaceStep(outline, stepId, { ...step, media: withMediaFocal(media, focal) } as OutlineStep);
}

/**
 * The same media with a different named aspect (or none — surfaces fall back to
 * type defaults: 16:9 video, free crop for images).
 */
export function withMediaAspect(
  media: OutlineMedia,
  aspect: OutlineMediaAspect | undefined,
): OutlineMedia {
  const next = { ...media };
  if (aspect === undefined) delete next.aspect;
  else next.aspect = aspect;
  return next;
}

export function withMediaPlace(
  media: OutlineMedia,
  place: OutlineMediaPlace | undefined,
): OutlineMedia {
  const next = { ...media };
  if (place === undefined) delete next.place;
  else next.place = place;
  return next;
}

/** Which slot the picture occupies. Also moves the step onto a layout that slot can fill. */
export function setMediaPlace(
  outline: Outline,
  stepId: string,
  place: OutlineMediaPlace,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const media = stepMedia(step);
  if (media === undefined) return outline;
  const layout = layoutForMediaPlace(step.kind, place);
  const next = { ...step, media: withMediaPlace(media, place) } as OutlineStep;
  if (layout !== (step.layout ?? LAYOUTS_FOR_KIND[step.kind][0])) {
    next.layout = layout;
  }
  return replaceStep(outline, stepId, next);
}

export function withMediaSize(media: OutlineMedia, size: number | undefined): OutlineMedia {
  const next = { ...media };
  if (size === undefined || size === MEDIA_SIZE_DEFAULT) delete next.size;
  else next.size = clampMediaSize(size);
  // The box is the size now — a leftover named aspect would letterbox inside it.
  if (next.type === 'image') delete next.aspect;
  return next;
}

/** How much of the slide the picture takes, 20–100. The canvas handles write this. */
export function setMediaSize(outline: Outline, stepId: string, size: number): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const media = stepMedia(step);
  if (media === undefined) return outline;
  return replaceStep(outline, stepId, { ...step, media: withMediaSize(media, size) } as OutlineStep);
}

export function clampBox(box: OutlineElementBox): OutlineElementBox {
  const w = Math.min(ELEMENT_BOX_MAX, Math.max(ELEMENT_BOX_MIN, Math.round(box.w)));
  const h = Math.min(ELEMENT_BOX_MAX, Math.max(ELEMENT_BOX_MIN, Math.round(box.h)));
  const x = Math.min(ELEMENT_BOX_MAX - w, Math.max(0, Math.round(box.x)));
  const y = Math.min(ELEMENT_BOX_MAX - h, Math.max(0, Math.round(box.y)));
  return { x, y, w, h };
}

function nextElementId(existing: readonly OutlineElement[], prefix: string): string {
  const taken = new Set(existing.map((item) => item.id));
  if (!taken.has(prefix)) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${String(n)}`)) n += 1;
  return `${prefix}-${String(n)}`;
}

function writeElements(outline: Outline, stepId: string, elements: OutlineElement[]): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return outline;
  const next = { ...step } as OutlineStep & { elements?: OutlineElement[] };
  if (elements.length === 0) delete next.elements;
  else next.elements = elements;
  return keepValid(outline, replaceStep(outline, stepId, next));
}

function staggerBox(count: number, base: OutlineElementBox): OutlineElementBox {
  const shift = (count % 6) * 6;
  return clampBox({ ...base, x: base.x + shift, y: base.y + shift });
}

export function addTextElement(
  outline: Outline,
  stepId: string,
  /** Percent point on the slide the author clicked; the box's top-left corner. */
  at?: { x: number; y: number },
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'box');
  const element: OutlineElement = {
    id,
    type: 'text',
    text: '',
    box:
      at === undefined
        ? staggerBox(current.length, { x: 8, y: 42, w: 70, h: 22 })
        : clampBox({ x: at.x, y: at.y, w: 40, h: 12 }),
  };
  return { outline: writeElements(outline, stepId, [...current, element]), elementId: id };
}

export function addImageElement(
  outline: Outline,
  stepId: string,
  media: OutlineMedia,
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'pic');
  const element: OutlineImageElement = {
    id,
    type: 'image',
    alt: media.alt,
    box: staggerBox(current.length, { x: 52, y: 14, w: 40, h: 72 }),
  };
  if (media.url !== undefined) element.url = media.url;
  if (media.assetId !== undefined) element.assetId = media.assetId;
  if (media.resourceId !== undefined) element.resourceId = media.resourceId;
  if (media.caption !== undefined) element.caption = media.caption;
  if (media.focal !== undefined) element.focal = media.focal;
  return { outline: writeElements(outline, stepId, [...current, element]), elementId: id };
}

export function addHtmlElement(
  outline: Outline,
  stepId: string,
  html: string,
  css?: string,
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'fig');
  const element: OutlineHtmlElement = {
    id,
    type: 'html',
    html,
    box: staggerBox(current.length, { x: 8, y: 48, w: 84, h: 42 }),
  };
  if (css !== undefined && css !== '') element.css = css;
  const next = writeElements(outline, stepId, [...current, element]);
  return { outline: keepValid(outline, next) === next ? next : outline, elementId: keepValid(outline, next) === next ? id : '' };
}

/**
 * Add reading material: a markdown-backed html element filling the slide.
 *
 * Full-bleed like a web page or a PDF, not staggered like a drawing — the point
 * of reading material is that the learner scrolls it, so it gets the whole
 * slide. `html` is derived here and nowhere else in the editor, which is what
 * keeps it in step with its source.
 */
export function addMarkdownElement(
  outline: Outline,
  stepId: string,
  markdown: string,
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'read');
  const element: OutlineHtmlElement = {
    id,
    type: 'html',
    html: renderMarkdownToHtml(markdown),
    markdown,
    box: { x: 0, y: 0, w: 100, h: 100 },
  };
  const next = writeElements(outline, stepId, [...current, element]);
  const valid = keepValid(outline, next);
  return { outline: valid, elementId: valid === next ? id : '' };
}

/** Rewrite reading material from its markdown source. */
export function setElementMarkdown(
  outline: Outline,
  stepId: string,
  elementId: string,
  markdown: string,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'html') return item;
    const next: OutlineHtmlElement = { ...item, html: renderMarkdownToHtml(markdown), markdown };
    return next;
  });
  return keepValid(outline, writeElements(outline, stepId, [...elements]));
}

/** Add a sandboxed web page that fills the slide canvas by default. */
export function addIframeElement(
  outline: Outline,
  stepId: string,
  url: string,
  title: string,
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'web');
  const element: OutlineIframeElement = {
    id,
    type: 'iframe',
    url,
    title,
    box: { x: 0, y: 0, w: 100, h: 100 },
  };
  const next = writeElements(outline, stepId, [...current, element]);
  const valid = keepValid(outline, next);
  return { outline: valid, elementId: valid === next ? id : '' };
}

/** Add a PDF document that fills the slide and scrolls in the live session. */
export function addPdfElement(
  outline: Outline,
  stepId: string,
  source: string | Pick<OutlinePdfElement, 'url' | 'assetId' | 'resourceId'>,
  title: string,
): { outline: Outline; elementId: string } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined || !kindCanCarryElements(step.kind)) return { outline, elementId: '' };
  const current = [...stepElements(step)];
  if (current.length >= ELEMENT_MAX) return { outline, elementId: '' };
  const id = nextElementId(current, 'pdf');
  const element: OutlinePdfElement = {
    id,
    type: 'pdf',
    ...(typeof source === 'string' ? { url: source } : source),
    title,
    box: { x: 0, y: 0, w: 100, h: 100 },
  };
  const next = writeElements(outline, stepId, [...current, element]);
  const valid = keepValid(outline, next);
  return { outline: valid, elementId: valid === next ? id : '' };
}

export function setElementBox(
  outline: Outline,
  stepId: string,
  elementId: string,
  box: OutlineElementBox,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const current = stepElements(step);
  const elements = current.map((item) => (item.id === elementId ? { ...item, box: clampBox(box) } : item));
  if (elements.every((item, index) => item === current[index])) return outline;
  return writeElements(outline, stepId, [...elements]);
}

export function setElementText(outline: Outline, stepId: string, elementId: string, text: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const nextText = text.trim() === '' ? '' : text;
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'text') return item;
    // Spans stay consistent with the new text: the untouched prefix and suffix
    // keep their styling, and the edited middle inherits the format it had.
    const spans =
      item.spans === undefined ? item.spans : normalizeSpans(retargetSpans(item.text, item.spans, nextText));
    return spans === undefined ? { ...item, text: nextText } : { ...item, text: nextText, spans };
  });
  return writeElements(outline, stepId, [...elements]);
}

/**
 * Write a full span list for one text element. The plain `text` mirror is
 * derived here, never passed in — the concat invariant cannot drift.
 */
export function setElementSpans(outline: Outline, stepId: string, elementId: string, spans: readonly TextSpan[]): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const normalized = normalizeSpans(spans);
  if (normalized.length === 0 || normalized.every((span) => span.text.length === 0)) return outline;
  const elements = stepElements(step).map((item) =>
    item.id === elementId && item.type === 'text'
      ? { ...item, text: normalized.map((span) => span.text).join(''), spans: normalized }
      : item,
  );
  return writeElements(outline, stepId, [...elements]);
}

/** Apply a style patch to `[start, end)` of one text element's characters. */
export function styleElementRange(
  outline: Outline,
  stepId: string,
  elementId: string,
  start: number,
  end: number,
  patch: Partial<Omit<TextSpan, 'text'>>,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const element = stepElements(step).find(
    (item): item is Extract<OutlineElement, { type: 'text' }> => item.id === elementId && item.type === 'text',
  );
  if (element === undefined) return outline;
  const current = element.spans ?? [{ text: element.text }];
  const clamped: Partial<Omit<TextSpan, 'text'>> =
    patch.size === undefined ? patch : { ...patch, size: clampSpanSize(patch.size) };
  return setElementSpans(outline, stepId, elementId, styleRange(current, start, end, clamped));
}

/** Element-level alignment. */
export function setElementAlign(
  outline: Outline,
  stepId: string,
  elementId: string,
  align: TextElementAlignment,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  if (!(TEXT_ELEMENT_ALIGNMENTS as readonly string[]).includes(align)) return outline;
  const elements = stepElements(step).map((item) =>
    item.id === elementId && item.type === 'text' ? { ...item, align } : item,
  );
  return writeElements(outline, stepId, [...elements]);
}

/** Strip every style property from `[start, end)` — "Clear formatting". */
export function clearElementStyling(
  outline: Outline,
  stepId: string,
  elementId: string,
  start?: number,
  end?: number,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const element = stepElements(step).find(
    (item): item is Extract<OutlineElement, { type: 'text' }> => item.id === elementId && item.type === 'text',
  );
  if (element === undefined) return outline;
  if (element.spans === undefined) return outline;
  if (start !== undefined && end !== undefined && end > start) {
    const total = element.text.length;
    const clampedEnd = Math.min(end, total);
    const cleared = clearStyleRange(element.spans, start, clampedEnd);
    return setElementSpans(outline, stepId, elementId, cleared);
  }
  // No range: drop `spans` entirely. The plain `text` remains.
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'text') return item;
    const next: typeof item = { ...item };
    delete next.spans;
    return next;
  });
  return writeElements(outline, stepId, [...elements]);
}

export function setElementImage(
  outline: Outline,
  stepId: string,
  elementId: string,
  media: OutlineMedia,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'image') return item;
    const {
      url: _url,
      assetId: _assetId,
      resourceId: _resourceId,
      ...identity
    } = item;
    const next: OutlineImageElement = { ...identity, alt: media.alt };
    if (media.url !== undefined) next.url = media.url;
    if (media.assetId !== undefined) next.assetId = media.assetId;
    if (media.resourceId !== undefined) next.resourceId = media.resourceId;
    if (media.caption !== undefined) next.caption = media.caption;
    else delete next.caption;
    if (media.focal !== undefined) next.focal = media.focal;
    return next;
  });
  return writeElements(outline, stepId, [...elements]);
}

/**
 * What a picture chosen in the picture dialog is for.
 *
 * The gesture that opened the dialog decides, not the selection that happens
 * to be live when it closes: `title`, `statement` and `media` can carry both a
 * wired picture and freeform elements, so "change this slide's picture" and
 * "add a picture object" are two different verbs on the same slide and cannot
 * be told apart after the fact.
 */
export type PictureTarget =
  | { kind: 'media' }
  | { kind: 'element'; elementId: string }
  | { kind: 'new' };

/**
 * Route a chosen picture to its target and name the part to select after.
 *
 * `partKey` is `null` when the target no longer exists — the element was
 * removed while the dialog was open, or the kind cannot hold the picture — and
 * the outline comes back untouched.
 */
export function applyPictureTarget(
  outline: Outline,
  stepId: string,
  target: PictureTarget,
  media: OutlineMedia,
): { outline: Outline; partKey: string | null } {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return { outline, partKey: null };
  if (target.kind === 'element') {
    const element = stepElements(step).find((item) => item.id === target.elementId);
    if (element?.type !== 'image') return { outline, partKey: null };
    return {
      outline: setElementImage(outline, stepId, target.elementId, media),
      partKey: `el-${target.elementId}`,
    };
  }
  // An insert lands as a freeform object wherever objects are allowed; on a
  // kind that has only the wired slot it fills that slot instead.
  if (target.kind === 'new' && kindCanCarryElements(step.kind)) {
    const result = addImageElement(outline, stepId, media);
    if (result.elementId === '') return { outline, partKey: null };
    return { outline: result.outline, partKey: `el-${result.elementId}` };
  }
  if (!kindCanCarryPicture(step.kind)) return { outline, partKey: null };
  return { outline: setMedia(outline, stepId, media), partKey: 'image' };
}

export function setElementHtml(
  outline: Outline,
  stepId: string,
  elementId: string,
  html: string,
  css?: string,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'html') return item;
    const next: OutlineHtmlElement = { ...item, html };
    if (css === undefined || css === '') delete next.css;
    else next.css = css;
    return next;
  });
  const written = writeElements(outline, stepId, [...elements]);
  return keepValid(outline, written);
}

export function setElementIframe(
  outline: Outline,
  stepId: string,
  elementId: string,
  url: string,
  title: string,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).map((item) =>
    item.id === elementId && item.type === 'iframe' ? { ...item, url, title } : item,
  );
  return keepValid(outline, writeElements(outline, stepId, [...elements]));
}

export function setElementPdf(
  outline: Outline,
  stepId: string,
  elementId: string,
  source: string | Pick<OutlinePdfElement, 'url' | 'assetId' | 'resourceId'>,
  title: string,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).map((item) => {
    if (item.id !== elementId || item.type !== 'pdf') return item;
    const { url: _url, assetId: _assetId, resourceId: _resourceId, ...rest } = item;
    return { ...rest, ...(typeof source === 'string' ? { url: source } : source), title };
  });
  return keepValid(outline, writeElements(outline, stepId, [...elements]));
}

export function removeElement(outline: Outline, stepId: string, elementId: string): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const elements = stepElements(step).filter((item) => item.id !== elementId);
  if (elements.length === stepElements(step).length) return outline;
  return writeElements(outline, stepId, [...elements]);
}

/** Named frame shape for the player / picture. */
export function setMediaAspect(
  outline: Outline,
  stepId: string,
  aspect: OutlineMediaAspect | undefined,
): Outline {
  const step = outline.steps.find((item) => item.id === stepId);
  if (step === undefined) return outline;
  const media = stepMedia(step);
  if (media === undefined) return outline;
  return replaceStep(outline, stepId, { ...step, media: withMediaAspect(media, aspect) } as OutlineStep);
}
