/**
 * UC-58 — Revealing the next part never moves or resizes the parts already shown.
 * Contract: docs/journeys/UC-58-reveal-stability.md
 */
import { expect, test, type Page } from '@playwright/test';
import { stageUrl, waitForWorker } from '../fixtures/session';
import { goto, liveSession, measureSlide, pictureUrl, servePictures, type Box } from '../fixtures/slide-geometry';
import { DECK_ASPECT_RATIOS, defaultDeckDesign, type DeckAspectRatio } from '../../packages/schema/src/deck-design';
import type { Outline, OutlineStep } from '../../packages/schema/src/outline-types';

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

const one = (count: number) => Array.from({ length: count }, (_, i) => [`cell-${String(i)}`]);
const photo = (place: 'right' | 'bottom') => ({ type: 'image' as const, url: pictureUrl(1600, 900), alt: 'A landscape picture', place });
const cards = (count: number) => Array.from({ length: count }, (_, i) => ({ text: `Card ${String(i + 1)}: one short sentence` }));

/** Grids and split lists (LG-09). */
const LISTS: OutlineStep[] = [
  { id: 'cards-4', kind: 'cards', title: 'Four cards', items: cards(4), reveal: [['header'], ...one(4)] },
  { id: 'cards-6', kind: 'cards', title: 'Six cards', items: cards(6), reveal: [['header'], ...one(6)] },
  { id: 'steps-12', kind: 'steps', title: 'Twelve steps', items: Array.from({ length: 12 }, (_, i) => `Step ${String(i + 1)}`), reveal: [['header'], ...one(12)] },
  { id: 'split-picture-last', kind: 'steps', layout: 'split', title: 'Picture last', items: ['Listen', 'Repeat', 'Write'], media: photo('right'), reveal: [['header'], ...one(3), ['image']] },
  { id: 'split-picture-first', kind: 'cards', layout: 'split', title: 'Picture first', items: cards(3), media: photo('right'), reveal: [['header'], ['image'], ...one(3)] },
];

/** Centred title and statement stacks (LD6), with the stat revealed in its drawn order. */
const STACKS: OutlineStep[] = [
  { id: 'statement-stat', kind: 'statement', stat: '2,500,000', title: 'Travellers a day', body: 'More people take the train than the bus.', reveal: [['stat'], ['header'], ['body']] },
  { id: 'title-body', kind: 'title', title: 'The station', body: 'A short walk from the market.', reveal: [['header'], ['body']] },
  { id: 'statement-picture', kind: 'statement', title: 'Look at the picture', body: 'Describe two things you notice.', media: photo('bottom'), reveal: [['header'], ['body'], ['image']] },
];

async function wallFor(page: Page, ratio: DeckAspectRatio, steps: OutlineStep[]) {
  const outline: Outline = { version: 1, meta: { title: `Reveal ${ratio}` }, interactions: [], design: { ...defaultDeckDesign('clean'), aspectRatio: ratio }, steps };
  const session = await liveSession(outline);
  await servePictures(page);
  await page.goto(stageUrl(session));
  return { session, wall: page.locator('.stage__main .slide-surface') };
}

/** Steps through every reveal of every step and holds each shown part to the box it had at the previous reveal. */
async function revealAll(page: Page, ratio: DeckAspectRatio, steps: OutlineStep[], shot: string, outputPath: (name: string) => string) {
  const { session, wall } = await wallFor(page, ratio, steps);
  for (const step of steps) {
    const groups = step.reveal!;
    let before: Record<string, Box> = {};
    for (let shown = 1; shown <= groups.length; shown += 1) {
      await goto(session, step.id, shown);
      const keys = groups.slice(0, shown).flat();
      await expect(wall.locator('[data-part]')).toHaveCount(keys.length);
      if (keys.includes('header')) await expect(wall.locator('[data-part="header"]')).toHaveText((step as { title: string }).title);
      for (const key of keys) await expect(wall.locator(`[data-part="${key}"]`)).toBeVisible();
      const { parts, cut } = await measureSlide(wall, 8);
      expect.soft(cut, `${step.id} at reveal ${String(shown)}: nothing is cut`).toEqual([]);
      for (const [key, box] of Object.entries(before)) {
        for (const axis of ['x', 'y', 'w', 'h'] as const) {
          expect.soft(Math.abs(parts[key]![axis] - box[axis]), `${step.id}/${key}/${axis} moves at reveal ${String(shown)}`).toBeLessThan(0.002);
        }
      }
      before = parts;
    }
    if (step.id === shot) await wall.screenshot({ path: outputPath(`${step.id}.png`) });
  }
}

for (const ratio of DECK_ASPECT_RATIOS) {
  test(`${ratio}: grid and split items keep their box at every reveal`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await revealAll(page, ratio, LISTS, 'cards-6', (name) => testInfo.outputPath(name));
  });

  test(`${ratio}: title and statement stacks keep their box at every reveal`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await revealAll(page, ratio, STACKS, 'statement-picture', (name) => testInfo.outputPath(name));
  });
}
