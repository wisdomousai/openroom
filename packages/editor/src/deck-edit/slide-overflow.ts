import { useLayoutEffect, useState } from 'react';
import type { OutlineStep } from '@openroom/schema';
import { partLabel } from './outline-edit';

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

/** A part can fit the slide but still be clipped by its column. */
function outsideClip(element: HTMLElement, surface: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
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

export function measureSlideOverflow(surface: HTMLElement, step: OutlineStep): SlideOverflowIssue[] {
  const issues = new Map<string, SlideOverflowIssue>();
  for (const element of surface.querySelectorAll<HTMLElement>(TARGETS)) {
    if (element.closest('[data-slide-decoration=""]') || element.getClientRects().length === 0) continue;
    const target = element.dataset.overflowTarget ?? element.dataset.part!;
    const partKey = element.dataset.overflowPart ?? element.dataset.part!;
    const style = getComputedStyle(element);
    // Reading/PDF content scrolls intentionally; its outer placement still matters.
    const scrolls = element.matches('.outline-step__element--reading, .outline-step__element--pdf');
    const textOverflow = !scrolls && !!element.textContent?.trim() &&
      ((style.overflowY !== 'auto' && style.overflowY !== 'scroll' && element.scrollHeight > element.clientHeight + TOLERANCE) ||
       (style.overflowX !== 'auto' && style.overflowX !== 'scroll' && element.scrollWidth > element.clientWidth + TOLERANCE));
    const htmlOverflow = element.querySelector('[data-content-overflow="true"]') !== null;
    const boundsOverflow = outsideClip(element, surface);
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
