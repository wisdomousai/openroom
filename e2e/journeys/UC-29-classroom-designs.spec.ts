import { test, expect } from '@playwright/test';
import { defaultDeckDesign, DECK_ASPECT_RATIOS, SLIDE_THEME_FAMILIES } from '../../packages/schema/src/deck-design';
import { SLIDE_TEMPLATES } from '../../packages/schema/src/slide-templates';
import type { Outline } from '../../packages/schema/src/outline-types';
import { insertTemplate } from '../../packages/editor/src/deck-edit/outline-edit/templates';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

for (const family of SLIDE_THEME_FAMILIES) {
  test(`${family}: every template fits all three authored slide sizes`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
    const cookies = await page.context().cookies();
    await page.context().clearCookies();
    await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
    let content: Outline = { version: 1, meta: { title: `${family} classroom templates` }, design: defaultDeckDesign(family), steps: [], interactions: [] };
    for (const template of SLIDE_TEMPLATES) content = insertTemplate(content, content.steps.at(-1)?.id ?? null, template.id).outline;
    expect(content.steps).toHaveLength(SLIDE_TEMPLATES.length);
    const created = await page.request.post('/api/decks', { headers: CSRF, data: { content } });
    expect(created.status()).toBe(201);
    const { deck } = await created.json();
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    const rows = page.getByRole('list', { name: 'Slides' }).getByRole('button');
    const surface = page.locator('.slide-canvas__frame .slide-surface');
    await expect(surface).toHaveAttribute('data-slide-theme', family);
    for (const ratio of DECK_ASPECT_RATIOS) {
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await expect(surface).toHaveAttribute('data-slide-aspect', ratio);
      for (const [index, template] of SLIDE_TEMPLATES.entries()) {
        await rows.nth(index).click();
        await expect(rows.nth(index)).toHaveAttribute('aria-current', 'true');
        const clipped = await surface.evaluate(async (slide) => {
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const frame = slide.getBoundingClientRect();
          return [...slide.querySelectorAll<HTMLElement>('[data-part]')].filter((part) => {
            if (!part.textContent?.trim() || part.offsetHeight === 0 || part.dataset.part === 'image') return false;
            const box = part.getBoundingClientRect();
            return part.scrollHeight > part.clientHeight + 2 || part.scrollWidth > part.clientWidth + 2
              || box.top < frame.top - 2 || box.left < frame.left - 2 || box.right > frame.right + 2 || box.bottom > frame.bottom + 2;
          }).map((part) => ({ part: part.dataset.part, text: part.textContent?.slice(0, 100) }));
        });
        expect.soft(clipped, `${family} / ${ratio} / ${template.name}`).toEqual([]);
        if (['title', 'cards', 'reading', 'choice'].includes(template.id) || clipped.length > 0) {
          await surface.screenshot({ path: testInfo.outputPath(`${family}-${ratio.replace(':', '-')}-${template.id}.png`) });
        }
      }
    }
  });
}
