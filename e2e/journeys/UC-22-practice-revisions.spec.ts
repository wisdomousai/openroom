import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('practice keeps the answered exercise through a lost response and tutor revisions', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const created = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Camille', kind: 'person', experience: 'tutoring' } })).json();
  const { id: contextId, spaceId } = created.context;
  const deck = await page.request.post('/api/decks', { headers: CSRF, data: { contextId, spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Les saisons et les mois' }, steps: [{ id: 'hello', kind: 'title', title: 'Les saisons' }], interactions: [] },
  } });
  expect(deck.status()).toBe(201);
  const sessionId = (await deck.json()).session.id;
  expect((await page.request.post(`/api/sessions/${sessionId}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  const publish = async (prompt: string, answer: string, revision?: number) => {
    const response = await page.request.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: {
      homeworkRevision: revision, homework: [{ id: 'practice', kind: 'quiz', interaction: { id: 'q', type: 'text', prompt, correctAnswers: [answer], match: { accents: 'require' } } }],
    } });
    expect(response.status()).toBe(200);
  };
  await publish('La saison après le printemps ?', 'été');
  const { token } = await (await page.request.post(`/api/tutoring/contexts/${contextId}/links`, { headers: CSRF, data: {} })).json();
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const submissions: Record<string, unknown>[] = [];
  let loseResponse = true;
  await learner.route('**/api/learner/practice', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    submissions.push(route.request().postDataJSON());
    if (!loseResponse) { await route.continue(); return; }
    loseResponse = false;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('connectionfailed');
  });
  await learner.goto(`/host/#/learn?token=${token}`);
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  const practice = learner.locator('section').filter({ has: learner.getByRole('heading', { name: 'Practice', exact: true }) });
  await practice.getByRole('textbox', { name: 'Your answer', exact: true }).fill('ete');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await practice.getByRole('button', { name: 'Again', exact: true }).click();
  await expect(practice.getByRole('alert')).toHaveText('Your practice could not be saved. Try again.');
  await publish('Welcher Monat kommt nach Februar?', 'März', 1);
  await practice.getByRole('button', { name: 'Again', exact: true }).click();
  await expect(practice).toHaveCount(0);
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  const pickup = await (await page.request.get(`/api/tutoring/contexts/${contextId}/returned`)).json();
  expect(pickup.missed).toEqual([expect.objectContaining({ exercise: expect.objectContaining({ interaction: expect.objectContaining({ prompt: 'La saison après le printemps ?' }) }), lastAnswer: { kind: 'text', text: 'ete' } })]);

  await learner.reload();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(practice.getByText('Welcher Monat kommt nach Februar?', { exact: true })).toBeVisible();
  await practice.getByRole('textbox', { name: 'Your answer', exact: true }).fill('März');
  await publish('Welcher Monat kommt nach März?', 'April', 2);
  // A deliberate background refresh must not replace the question under the answer.
  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  const refreshed = learner.waitForResponse((response) => response.url().endsWith('/api/learner/practice') && response.request().method() === 'GET');
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await refreshed;
  await expect(practice.getByText('Welcher Monat kommt nach Februar?', { exact: true })).toBeVisible();
  await expect(practice.getByRole('textbox')).toHaveValue('März');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(practice.getByRole('alert')).toContainText('This exercise has changed.');
  await expect(practice.getByRole('textbox')).toHaveValue('März');
  await learner.screenshot({ path: testInfo.outputPath('practice-revised.png'), fullPage: true });
  await learner.route('**/api/learner/practice?itemId=*', (route) => route.abort('connectionfailed'), { times: 1 });
  await practice.getByRole('button', { name: 'Load current exercise', exact: true }).click();
  await expect(practice.getByRole('alert')).toHaveText('The current exercise could not be loaded. Try again.');
  await practice.getByRole('button', { name: 'Load current exercise', exact: true }).click();
  await expect(practice.getByText('Welcher Monat kommt nach März?', { exact: true })).toBeVisible();
  await expect(practice.getByRole('textbox')).toHaveValue('');
  await practice.getByRole('textbox').fill('April');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(practice).toHaveCount(0);
  expect(submissions.at(-1)?.assignmentRevision).toBe(3);
  await learner.reload();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(practice).toHaveCount(0);
  const task = (id: string, prompt: string) => ({ id, kind: 'quiz', interaction: { id, type: 'text', prompt } });
  const removed = task('removed', 'Une question retirée ensuite.');
  const remaining = task('remaining', 'Où aimeriez-vous voyager ?');
  expect((await page.request.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: { homeworkRevision: 3, homework: [removed, remaining] } })).status()).toBe(200);
  await learner.reload();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await practice.getByRole('textbox').fill('Ma réponse.');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  expect((await page.request.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: { homeworkRevision: 4, homework: [remaining] } })).status()).toBe(200);
  await practice.getByRole('button', { name: 'Confident', exact: true }).click();
  await expect(practice.getByRole('alert')).toContainText('This exercise has changed.');
  await practice.getByRole('button', { name: 'Load current exercise', exact: true }).click();
  await expect(practice.getByRole('status')).toHaveText('This exercise is no longer assigned to you.');
  await practice.getByRole('button', { name: 'Continue practice', exact: true }).click();
  await expect(practice.getByText(remaining.interaction.prompt, { exact: true })).toBeVisible();
  expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await learner.close();
});
