/**
 * UC-56 — Text at the documented budgets fits the wall and the phone Slide.
 * Contract: docs/journeys/UC-56-slide-capacity.md
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/learner-browser';
import { joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';
import { goto, liveSession, measureSlide } from '../fixtures/slide-geometry';
import { DECK_ASPECT_RATIOS, defaultDeckDesign } from '../../packages/schema/src/deck-design';
import { outlineWarnings } from '../../packages/schema/src/outline-fit';
import type { Outline, OutlineStep } from '../../packages/schema/src/outline-types';

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

function prose(length: number, seed: string): string {
  let text = `${seed} `;
  while (text.length < length) text += 'le train part à huit heures et arrive à midi ';
  return text.slice(0, length);
}
const list = (count: number, length: number, seed: string) => Array.from({ length: count }, (_, i) => prose(length, `${seed}${String(i + 1)}`));

/** The budgets the outline_validate description states (packages/mcp/src/tools.ts), at the default margin of 8. */
const BUDGETS: OutlineStep[] = [
  { id: 'title', kind: 'title', title: prose(100, 'Titre') },
  { id: 'statement', kind: 'statement', title: 'Le voyage', body: prose(300, 'Corps') },
  { id: 'cards-4', kind: 'cards', title: 'Quatre cartes', items: list(4, 140, 'Carte').map((text) => ({ text })) },
  { id: 'cards-6', kind: 'cards', title: 'Six cartes', items: list(6, 70, 'Carte').map((text) => ({ text })) },
  { id: 'steps-6', kind: 'steps', title: 'Six étapes', items: list(6, 40, 'Étape') },
  { id: 'steps-3', kind: 'steps', title: 'Trois étapes', items: list(3, 80, 'Étape') },
  { id: 'activity-6', kind: 'activity', title: 'Six consignes', instructions: list(6, 40, 'Consigne') },
  { id: 'activity-3', kind: 'activity', title: 'Trois consignes', instructions: list(3, 80, 'Consigne') },
  { id: 'debrief-6', kind: 'debrief', title: 'Six questions', prompts: list(6, 40, 'Question') },
  { id: 'debrief-3', kind: 'debrief', title: 'Trois questions', prompts: list(3, 80, 'Question') },
];
const SAFE_AREAS = [8, 12] as const;

for (const ratio of DECK_ASPECT_RATIOS) {
  test(`${ratio}: budget text fits at margin 8, and any cut at margin 12 is warned`, async ({ browser, learnerBrowser }, testInfo) => {
    test.setTimeout(180_000);
    const design = defaultDeckDesign('clean');
    const outline: Outline = {
      version: 1, meta: { title: `Capacity ${ratio}` }, interactions: [],
      design: { ...design, aspectRatio: ratio, masters: SAFE_AREAS.map((safeArea) => ({ id: `m${String(safeArea)}`, name: `Margin ${String(safeArea)}`, safeArea, decoration: 'none' as const })), defaultMasterId: 'm8' },
      // All margin-8 slides, then all margin-12 slides: consecutive slides never share a heading.
      steps: SAFE_AREAS.flatMap((safeArea) => BUDGETS.map((step) => ({ ...structuredClone(step), id: `${step.id}-${String(safeArea)}`, design: { masterId: `m${String(safeArea)}` } }))),
    };
    const warned = new Set(outlineWarnings(outline).filter((warning) => warning.code === 'W_TEXT_FIT').map((warning) => Number(warning.path.split('/')[2])));
    const session = await liveSession(outline);
    const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    await stage.goto(stageUrl(session));
    const wall = stage.locator('.stage__main .slide-surface');
    const phone = await learnerBrowser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await joinInBrowser(phone, session.code);
    await phone.getByRole('button', { name: 'Slide', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Slide', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const plate = phone.locator('.learner-slide__plate .slide-surface');

    for (const [index, step] of outline.steps.entries()) {
      const safeArea = Number(step.id.split('-').at(-1));
      const heading = (step as { title: string }).title;
      await goto(session, step.id);
      for (const [name, surface] of [['wall', wall], ['phone', plate]] as const) {
        await expect(surface.locator('[data-part="header"]')).toHaveText(heading);
        const { cut } = await measureSlide(surface, safeArea);
        if (safeArea === 8) {
          expect.soft(cut, `${step.id} on the ${name}: nothing is cut at the stated budget`).toEqual([]);
          expect.soft(warned.has(index), `${step.id}: the estimator passes the stated budget`).toBe(false);
        } else if (cut.length > 0) {
          expect.soft(warned.has(index), `${step.id} on the ${name} cuts ${cut.join(', ')}, so outline_validate must warn W_TEXT_FIT`).toBe(true);
        }
        if (step.id === 'cards-4-8') await surface.screenshot({ path: testInfo.outputPath(`${step.id}-${name}.png`) });
      }
    }
    await phone.close();
    await stage.close();
  });
}
