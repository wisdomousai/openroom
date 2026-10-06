import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

for (const sample of [
  { language: 'Français', level: 'B1', title: 'Le train est parti', reading: 'Il pleuvait et le bus avançait lentement.' },
  { language: 'Deutsch', level: 'B2', title: 'Fortbildung, die im Alltag hilft', reading: 'Das Team soll ein neues Werkzeug nutzen.' },
]) test(`${sample.language} lesson opens in the selected folder and publishes self-contained homework`, async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: `${sample.language} lessons`, kind: 'person', experience: 'tutoring' } })).json();
  const { id: folderId } = await (await page.request.post(`/api/my/spaces/${context.spaceId}/folders`, { headers: CSRF, data: { name: 'Conversation' } })).json();
  await page.goto(`/host/#/space/${context.spaceId}?folderId=${folderId}&contextId=${context.id}`);
  await page.getByRole('link', { name: 'Sample lessons', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/samples\\?folderId=${folderId}`));
  await page.reload();
  await expect(page.getByText(/Saving in:.*Conversation/)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(8);
  await page.getByRole('group', { name: 'Lesson language' }).getByRole('button', { name: sample.language, exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByRole('group', { name: 'Lesson level' }).getByRole('button', { name: sample.level, exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByText('Lesson aims', { exact: true }).click();
  const preview = await page.getByRole('article').locator('.slide-surface').boundingBox();
  expect(preview!.height).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('sample-lesson-gallery.png') });
  await page.getByRole('button', { name: `Open ${sample.title}`, exact: true }).click();
  await expect(page).toHaveURL(/#\/decks\/[^/]+\/edit$/);
  const deckId = /decks\/([^/]+)\/edit/.exec(page.url())![1]!;
  const { deck, content } = await (await page.request.get(`/api/decks/${deckId}`)).json();
  expect(deck.folderId).toBe(folderId);
  expect(deck.contextId).toBe(context.id);
  expect(content.meta.title).toBe(sample.title);
  expect(content.homework.tasks).toHaveLength(4);
  await expect(page.getByText(`Lesson estimate ${content.meta.durationMinutes} min`, { exact: true })).toBeVisible();
  const slides = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
  await expect(slides).toHaveCount(12);
  for (let index = 0; index < 12; index++) {
    await slides.nth(index).click();
    await expect(slides.nth(index)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-slide-overflow]'), `${sample.title}, slide ${index + 1}`).toHaveCount(0);
    if (index === 3) await page.screenshot({ path: testInfo.outputPath('sample-lesson-reading.png') });
  }
  const { session } = await (await page.request.post('/api/sessions', { headers: CSRF, data: { deckId, deckVersion: deck.currentVersion, contextId: context.id, spaceId: context.spaceId, folderId } })).json();
  expect((await page.request.post(`/api/sessions/${session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  await page.goto(`/host/#/sessions/${session.id}/record`);
  await expect(page.getByRole('group', { name: 'Reading assignment', exact: true }).getByLabel('Reading', { exact: true })).toContainText(sample.reading);
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page).toHaveURL(/#\/space\//);
  const { token } = await (await page.request.post(`/api/tutoring/contexts/${context.id}/links`, { headers: CSRF, data: {} })).json();
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  await learner.goto(`/host/#/learn?token=${token}`);
  await expect(learner.getByText(sample.reading, { exact: false }).first()).toBeVisible();
  await expect(learner.getByRole('heading', { name: 'Writing', exact: true })).toBeVisible();
  await expect(learner.getByRole('heading', { name: 'Voice response', exact: true })).toBeVisible();
  await expect(learner.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await learner.close();
});
