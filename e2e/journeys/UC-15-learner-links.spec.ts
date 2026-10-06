import { test, expect, type Page } from '@playwright/test';
import { command, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('group learners keep private work across link replacement and same-tab switching', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const created = await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'French conversation group', kind: 'group', experience: 'tutoring' } });
  expect(created.status()).toBe(201);
  const { id: contextId, spaceId } = (await created.json()).context;
  const deck = await page.request.post('/api/decks', { headers: CSRF, data: {
    contextId, spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Un voyage mémorable' }, steps: [{ id: 'welcome', kind: 'title', title: 'Un voyage mémorable' }], interactions: [] },
  } });
  expect(deck.status()).toBe(201);
  const sessionId = (await deck.json()).session.id;
  const launch = await page.request.post(`/api/sessions/${sessionId}/launch`, { headers: CSRF, data: { start: true } });
  expect(launch.status()).toBe(201);
  const { sessionCode, hostToken } = await launch.json();
  expect((await command(sessionCode, hostToken, { command: 'session.end' })).ok).toBe(true);
  expect((await page.request.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: {
    outcomes: ['Raconter un voyage au passé'], notes: 'PRIVATE TUTOR NOTES', homework: [
      { id: 'writing', kind: 'writing', title: 'Votre voyage', prompt: 'Racontez un voyage en trois phrases.' },
      { id: 'quiz', kind: 'quiz', interaction: { id: 'q', type: 'choice', prompt: 'Choisissez la phrase correcte.', options: [{ id: 'a', label: 'Nous sommes partis.', correct: true }, { id: 'b', label: 'Nous avons partis.' }] } },
    ], artifacts: [],
  } })).status()).toBe(200);

  async function createLink(name: string, existing = false) {
    await page.goto(`/host/#/tutor/contexts/${contextId}/links/new`);
    await expect(page.getByRole('heading', { name: 'Create a learner link' })).toBeVisible();
    const choice = page.getByRole('combobox', { name: 'Learner', exact: true });
    if (existing || name === 'Noor') {
      await choice.click();
      await page.getByRole('option', { name: existing ? name : 'New learner', exact: true }).click();
    }
    if (!existing) await page.getByLabel('Display name').fill(name);
    const response = page.waitForResponse((res) => res.url().endsWith(`/contexts/${contextId}/links`) && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    const res = await response;
    expect(res.status()).toBe(201);
    const result = await res.json() as { id: string; token: string; learnerId: string; tokenPrefix: string };
    await expect(page.getByRole('heading', { name: 'Copy this link now' })).toBeVisible();
    const url = await page.locator('code').innerText();
    await page.getByRole('link', { name: 'Done', exact: true }).click();
    return { ...result, url };
  }

  const lea = await createLink('Léa');
  const noor = await createLink('Noor');
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await learner.goto(lea.url);
  await expect(learner.getByRole('heading', { name: 'Léa', exact: true })).toBeVisible();
  const writing = learner.getByRole('textbox', { name: 'Racontez un voyage en trois phrases.' });
  await writing.fill('Je suis allée à Zürich. J’ai visité le musée. C’était très beau.');
  await learner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  const practice = learner.locator('section').filter({ has: learner.getByRole('heading', { name: 'Practice', exact: true }) });
  await practice.getByRole('button', { name: 'Nous sommes partis.', exact: true }).click();
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(practice).toHaveCount(0);

  // Hash navigation keeps the same JS app alive: this catches cross-link cache leaks.
  const switchTo = async (target: Page, url: string) => target.evaluate((value) => { location.hash = new URL(value).hash; }, url);
  await switchTo(learner, noor.url);
  await expect(learner.getByRole('heading', { name: 'Noor', exact: true })).toBeVisible();
  await expect(writing).toHaveValue('');
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(practice).toBeVisible();
  await expect(learner.getByText('PRIVATE TUTOR NOTES')).toHaveCount(0);
  await expect(learner.getByRole('navigation')).toHaveCount(0);

  const replacement = await createLink('Léa', true);
  expect(replacement.learnerId).toBe(lea.learnerId);
  await page.getByText('Student access links', { exact: true }).click();
  const oldLink = page.getByRole('listitem').filter({ hasText: lea.tokenPrefix });
  await oldLink.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke link', exact: true }).click();
  await expect(oldLink.getByText('Revoked', { exact: true })).toBeVisible();
  await switchTo(learner, lea.url);
  await expect(learner.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await switchTo(learner, replacement.url);
  await expect(learner.getByRole('heading', { name: 'Léa', exact: true })).toBeVisible();
  await expect(writing).toHaveValue('Je suis allée à Zürich. J’ai visité le musée. C’était très beau.');
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(practice).toHaveCount(0);
  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await learner.screenshot({ path: testInfo.outputPath('learner-private-work.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('group-learner-links.png'), fullPage: true });
  await learner.close();
});
