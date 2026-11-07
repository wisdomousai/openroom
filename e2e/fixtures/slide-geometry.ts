/**
 * Shared measuring for the slide layout journeys (UC-56 to UC-58): live
 * sessions made through the admin API, synthetic pictures, and the rendered
 * boxes of a slide's parts in fractions of the slide width.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { Outline } from '../../packages/schema/src/outline-types';
import { command, createSession, type CreatedSession } from './session';

export type Box = { x: number; y: number; w: number; h: number };

export interface SlideMeasure {
  /** Slide height in slide widths. */
  height: number;
  parts: Record<string, Box>;
  /** Parts the slide cuts: text clipped inside its box, a box clipped by a column, or a box in the margin. */
  cut: string[];
}

/** A running session for an outline; no demo account is used. */
export async function liveSession(outline: Outline): Promise<CreatedSession> {
  const session = await createSession(outline);
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  return session;
}

export async function goto(session: CreatedSession, stepId: string, shown?: number): Promise<void> {
  await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId });
  if (shown !== undefined) await command(session.sessionCode, session.hostToken, { command: 'outline.reveal', stepId, shown });
}

const PICTURES = 'https://pictures.openroom.test';

/** The URL of a synthetic width x height picture; `servePictures` answers it. */
export const pictureUrl = (width: number, height: number) => `${PICTURES}/${String(width)}x${String(height)}.svg`;

export async function servePictures(page: Page): Promise<void> {
  await page.route(`${PICTURES}/**`, (route) => {
    const [width, height] = new URL(route.request().url()).pathname.slice(1).replace('.svg', '').split('x');
    void route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#47624C"/><circle cx="50%" cy="50%" r="30%" fill="#E5A85E"/></svg>`,
    });
  });
}

/**
 * Measures every drawn part once fonts and pictures are ready. The cut test is
 * ported from the editor's overflow detector (slide-overflow.ts), plus the
 * margin rule of W_TEXT_FIT: a part may not reach into the master's safe area.
 */
export async function measureSlide(surface: Locator, safeArea: number): Promise<SlideMeasure> {
  for (const picture of await surface.locator('img').all()) {
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  return surface.evaluate(async (root, safe) => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const TOLERANCE = 2;
    const CLIPS = new Set(['hidden', 'clip', 'auto', 'scroll']);
    const frame = root.getBoundingClientRect();
    const margin = (frame.width * safe) / 100;
    const clipped = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        const left = bounds.left + parent.clientLeft;
        const top = bounds.top + parent.clientTop;
        if ((parent === root || CLIPS.has(style.overflowX)) && (box.left < left - TOLERANCE || box.right > left + parent.clientWidth + TOLERANCE)) return true;
        if ((parent === root || CLIPS.has(style.overflowY)) && (box.top < top - TOLERANCE || box.bottom > top + parent.clientHeight + TOLERANCE)) return true;
        if (parent === root) break;
      }
      return false;
    };
    const parts: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const cut: string[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('[data-part]')) {
      if (element.closest('[data-slide-decoration=""]') || element.getClientRects().length === 0) continue;
      const key = element.dataset.part!;
      const box = element.getBoundingClientRect();
      parts[key] = { x: (box.left - frame.left) / frame.width, y: (box.top - frame.top) / frame.width, w: box.width / frame.width, h: box.height / frame.width };
      const style = getComputedStyle(element);
      // Text past a clipping box is lost; text past a visible box (a tight
      // line height on a big number) still counts for the margin.
      const hides = (overflow: string) => overflow === 'hidden' || overflow === 'clip';
      const text = !!element.textContent?.trim() &&
        ((hides(style.overflowY) && element.scrollHeight > element.clientHeight + TOLERANCE) ||
         (hides(style.overflowX) && element.scrollWidth > element.clientWidth + TOLERANCE));
      const bottom = Math.max(box.bottom, box.top + element.scrollHeight);
      const right = Math.max(box.right, box.left + element.scrollWidth);
      const inMargin = box.top < frame.top + margin - TOLERANCE || bottom > frame.bottom - margin + TOLERANCE ||
        box.left < frame.left + margin - TOLERANCE || right > frame.right - margin + TOLERANCE;
      if (text || inMargin || clipped(element)) cut.push(key);
    }
    return { height: frame.height / frame.width, parts, cut };
  }, safeArea);
}
