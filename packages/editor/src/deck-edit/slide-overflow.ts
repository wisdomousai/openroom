import { useLayoutEffect, useState } from 'react';
import type { OutlineStep } from '@openroom/schema';
import { partLabel } from './outline-edit';
import { EDITOR_CHROME } from './selection-offsets';

export interface SlideOverflowIssue {
  target: string;
  partKey: string;
  label: string;
  reason: 'content' | 'bounds';
}

const TOLERANCE = 2;
const TARGETS = '[data-part], [data-overflow-target]';
const CLIPS = new Set(['hidden', 'clip', 'auto', 'scroll']);
export const EMPTY_ISSUES: SlideOverflowIssue[] = [];

/**
 * Whether a box reaches past an element that clips it. The walk starts at
 * `from` and ends at the slide surface, which always clips.
 */
function clippedBy(box: DOMRect, from: HTMLElement | null, surface: HTMLElement): boolean {
  for (let parent = from; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    const left = bounds.left + parent.clientLeft;
    const top = bounds.top + parent.clientTop;
    if ((parent === surface || CLIPS.has(style.overflowX)) &&
      (box.left < left - TOLERANCE || box.right > left + parent.clientWidth + TOLERANCE)) return true;
    if ((parent === surface || CLIPS.has(style.overflowY)) &&
      (box.top < top - TOLERANCE || box.bottom > top + parent.clientHeight + TOLERANCE)) return true;
    if (parent === surface) break;
  }
  return false;
}

/** The union of a part's text boxes, editor chrome left out; null when it has none. */
function textBox(element: HTMLElement): DOMRect | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest(EDITOR_CHROME)) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0 && rect.height === 0) continue;
      left = Math.min(left, rect.left); top = Math.min(top, rect.top);
      right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    }
  }
  return left === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Whether a part's own content is cut. A part that clips (`overflow: hidden`)
 * is cut when its content is larger than its box. A part that lets content
 * show (`overflow: visible`) is cut only when its text reaches past an
 * ancestor that clips: a term or heading set at line-height 0.85 always
 * reports a taller scroll height than its box, and its glyphs still show.
 */
function contentCut(element: HTMLElement, surface: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const ownY = style.overflowY === 'hidden' || style.overflowY === 'clip';
  const ownX = style.overflowX === 'hidden' || style.overflowX === 'clip';
  if (ownY && element.scrollHeight > element.clientHeight + TOLERANCE) return true;
  if (ownX && element.scrollWidth > element.clientWidth + TOLERANCE) return true;
  // A part that clips or scrolls holds its own text. (CSS never leaves one
  // axis visible when the other is not.)
  if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return false;
  const text = textBox(element);
  return text !== null && clippedBy(text, element.parentElement, surface);
}

export function measureSlideOverflow(surface: HTMLElement, step: OutlineStep): SlideOverflowIssue[] {
  const issues = new Map<string, SlideOverflowIssue>();
  for (const element of surface.querySelectorAll<HTMLElement>(TARGETS)) {
    if (element.closest('[data-slide-decoration=""]') || element.getClientRects().length === 0) continue;
    const target = element.dataset.overflowTarget ?? element.dataset.part!;
    const partKey = element.dataset.overflowPart ?? element.dataset.part!;
    // Reading/PDF content scrolls intentionally; its outer placement still matters.
    const scrolls = element.matches('.outline-step__element--reading, .outline-step__element--pdf');
    const textOverflow = !scrolls && !!element.textContent?.trim() && contentCut(element, surface);
    const htmlOverflow = element.querySelector('[data-content-overflow="true"]') !== null;
    const boundsOverflow = clippedBy(element.getBoundingClientRect(), element.parentElement, surface);
    if (!textOverflow && !htmlOverflow && !boundsOverflow) continue;
    issues.set(target, {
      target, partKey,
      label: target === 'word-bank' ? 'Word bank' : target === 'caption' ? 'Caption' : partLabel(step, partKey),
      reason: boundsOverflow ? 'bounds' : 'content',
    });
  }
  return [...issues.values()];
}

/** Observe the live DOM too: contenteditable text is saved only on blur. */
export function useSlideOverflow(frame: HTMLElement | null, step: OutlineStep, revision: unknown) {
  const [snapshot, setSnapshot] = useState<{ stepId: string; issues: SlideOverflowIssue[] }>({ stepId: '', issues: [] });
  useLayoutEffect(() => {
    const surface = frame?.querySelector<HTMLElement>('.slide-surface');
    if (!surface) return;
    let disposed = false;
    let scheduled = 0;
    const measure = () => {
      scheduled = 0;
      if (disposed) return;
      const issues = measureSlideOverflow(surface, step);
      setSnapshot((previous) => previous.stepId === step.id && JSON.stringify(previous.issues) === JSON.stringify(issues)
        ? previous : { stepId: step.id, issues });
    };
    const schedule = () => { if (!disposed && !scheduled) scheduled = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observeParts = () => {
      resize.disconnect();
      resize.observe(surface);
      for (const element of surface.querySelectorAll(TARGETS)) resize.observe(element);
    };
    observeParts();
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) observeParts();
      schedule();
    });
    mutations.observe(surface, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['style', 'class', 'data-content-overflow'] });
    surface.addEventListener('input', schedule);
    surface.addEventListener('load', schedule, true);
    document.fonts.addEventListener('loadingdone', schedule);
    void document.fonts.ready.then(schedule);
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(scheduled);
      mutations.disconnect(); resize.disconnect();
      surface.removeEventListener('input', schedule);
      surface.removeEventListener('load', schedule, true);
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [frame, step, revision]);
  return snapshot.stepId === step.id ? snapshot.issues : EMPTY_ISSUES;
}
