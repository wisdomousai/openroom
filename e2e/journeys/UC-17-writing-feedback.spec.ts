import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';
import { parse as parseYaml } from 'yaml';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('tutor drafts stay private; published corrections stay attached to the original response', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'French conversation', kind: 'group', experience: 'tutoring' } })).json();
  const { session, deck } = await (await page.request.post('/api/decks', { headers: CSRF, data: { contextId: context.id, spaceId: context.spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Un voyage en train' }, steps: [{ id: 'title', kind: 'title', title: 'Un voyage en train' }], interactions: [] },
  } })).json();
  expect((await page.request.post(`/api/sessions/${session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  expect((await page.request.put(`/api/sessions/${session.id}/record`, { headers: CSRF, data: { homework: [{ id: 'writing', kind: 'writing', title: 'Votre voyage', prompt: 'Racontez votre voyage.' }] } })).status()).toBe(200);
  const mint = async (displayName: string) => (await (await page.request.post(`/api/tutoring/contexts/${context.id}/links`, { headers: CSRF, data: { displayName } })).json()).token as string;
  const lea = await mint('Léa');
  const noor = await mint('Noor');
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await learner.goto(`/host/#/learn?token=${lea}`);
  const writing = learner.getByRole('textbox', { name: 'Racontez votre voyage.', exact: true });
  await writing.fill('Je suis allé à Berlin. Le train était confortable.');
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  await expect(writing).toHaveValue('Je suis allé à Berlin. Le train était confortable.');
  await learner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  await page.goto(`/host/#/space/${context.spaceId}?contextId=${context.id}`);
  await page.getByRole('link', { name: 'Review learner work', exact: true }).click();
  await page.getByRole('link', { name: /Léa.*Review response/s }).click();
  await expect(page.getByRole('heading', { name: 'Léa’s writing', exact: true })).toBeVisible();
  await page.getByLabel('Feedback', { exact: true }).fill('Votre récit est clair. Attention à l’accord du participe passé.');
  await page.getByRole('button', { name: 'Add correction', exact: true }).click();
  await page.getByLabel('Their words', { exact: true }).fill('allé');
  await page.getByLabel('Suggested wording', { exact: true }).fill('allée');
  await page.getByLabel('Why', { exact: true }).fill('Avec être, le participe passé s’accorde avec le sujet.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Your tutor’s feedback will appear here.')).toBeVisible();
  await expect(learner.getByText('Votre récit est clair.', { exact: false })).toHaveCount(0);

  await page.getByRole('button', { name: 'Share feedback', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback shared with Léa.' })).toBeVisible();
  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Votre récit est clair. Attention à l’accord du participe passé.')).toBeVisible();
  await expect(learner.getByText('Avec être, le participe passé s’accorde avec le sujet.')).toBeVisible();
  await learner.screenshot({ path: testInfo.outputPath('learner-feedback-phone.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('tutor-writing-review.png'), fullPage: true });
  await page.getByLabel('Feedback', { exact: true }).fill('PRIVATE DRAFT REVISION');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await learner.reload();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('PRIVATE DRAFT REVISION')).toHaveCount(0);
  await expect(learner.getByText('Votre récit est clair. Attention à l’accord du participe passé.')).toBeVisible();

  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  await writing.fill('Je suis allée à Berlin. Le train était confortable.');
  await learner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to learner work', exact: true }).click();
  await page.getByRole('link', { name: /Léa.*Review response/s }).click();
  await expect(page.getByLabel('Feedback', { exact: true })).toHaveValue('');
  await page.getByText('Other responses to this task', { exact: true }).click();
  await expect(page.getByText('Je suis allé à Berlin. Le train était confortable.', { exact: true })).toBeVisible();

  await learner.evaluate((token) => { location.hash = `/learn?token=${token}`; }, noor);
  await expect(learner.getByRole('heading', { name: 'Noor', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Your tutor’s feedback will appear here.')).toBeVisible();
  await expect(learner.getByText('Votre récit est clair.', { exact: false })).toHaveCount(0);
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByText('Léa · allé', { exact: true }).click();
  await page.getByRole('button', { name: 'Add correction to deck', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  const draft = await (await page.request.get(`/api/decks/${deck.id}/draft`)).json();
  const outline = parseYaml(draft.source);
  expect(outline.steps[1].items.map((item: { text: string }) => item.text)).toEqual(['allé', 'allée', 'Avec être, le participe passé s’accorde avec le sujet.']);
  expect(outline.steps[1].reveal).toEqual([['header', 'cell-0'], ['cell-1'], ['cell-2']]);
  expect(draft.source).not.toContain('PRIVATE DRAFT REVISION');
  expect(draft.source).not.toContain('Je suis allé à Berlin. Le train était confortable.');
  expect(draft.source).not.toContain('Léa');
  await learner.close();
});
