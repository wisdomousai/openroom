import { parse as parseYaml } from 'yaml';
import { test, expect } from '@playwright/test';
import { SLIDE_TEMPLATES } from '../../packages/schema/src/slide-templates';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('template gallery inserts editable slides without clipping and preserves saved content', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  await page.goto('/host/#/decks/new');
  await expect(page).toHaveURL(/#\/decks\/[^/]+\/edit$/);
  const id = /decks\/([^/]+)\/edit/.exec(page.url())![1]!;
  for (const [index, template] of SLIDE_TEMPLATES.entries()) {
    await page.getByRole('button', { name: 'New slide', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Choose a slide', exact: true });
    await expect(gallery).toBeVisible();
    if (index === 0) {
      const preview = await gallery.getByRole('button', { name: 'Insert Title', exact: true }).locator('.slide-surface').boundingBox();
      expect(preview!.height).toBeGreaterThan(100);
      await expect(gallery.getByText('A clear opening and one sentence of context.', { exact: true })).toBeVisible();
      await gallery.screenshot({ path: testInfo.outputPath('template-gallery.png') });
    }
    await gallery.getByRole('button', { name: `Insert ${template.name}`, exact: true }).click();
    await expect(gallery).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(index + 2);
    await expect(page.locator('[data-slide-overflow]'), template.name).toHaveCount(0);
  }
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(25);
  const draft = await (await page.request.get(`/api/decks/${id}/draft`)).json();
  const saved = parseYaml(draft.source);
  expect(saved.steps.slice(1).map((step: { design: { templateId: string } }) => step.design.templateId)).toEqual(SLIDE_TEMPLATES.map((template) => template.id));
  await page.screenshot({ path: testInfo.outputPath('template-deck.png') });
});
