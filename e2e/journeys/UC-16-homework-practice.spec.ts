import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';
import type { HomeworkPracticeInteraction } from '../../packages/schema/src/homework-practice';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('phone homework handles every practice format, accents and self-reflection', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const context = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Camille', kind: 'person', experience: 'tutoring' } })).json();
  const { id: contextId, spaceId } = context.context;
  const deck = await page.request.post('/api/decks', { headers: CSRF, data: { contextId, spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Français et allemand' }, steps: [{ id: 'hello', kind: 'title', title: 'Parlons ensemble' }], interactions: [] },
  } });
  expect(deck.status()).toBe(201);
  const sessionId = (await deck.json()).session.id;
  expect((await page.request.post(`/api/sessions/${sessionId}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  const questions: HomeworkPracticeInteraction[] = [
    { id: 'choice', type: 'choice', multiple: true, prompt: 'Choisissez les villes suisses.', options: [{ id: 'z', label: 'Zürich', correct: true }, { id: 'g', label: 'Genève', correct: true }, { id: 'p', label: 'Paris' }] },
    { id: 'text', type: 'text', prompt: 'La saison après le printemps ?', correctAnswers: ['été'], match: { locale: 'fr', accents: 'require' } },
    { id: 'gaps', type: 'fill-the-gaps', prompt: 'Ich {{verb}} aus {{country}}.', gaps: [{ id: 'verb', answers: ['komme'] }, { id: 'country', answers: ['Deutschland', 'Österreich'] }] },
    { id: 'match', type: 'match', prompt: 'Reliez les mots.', left: [{ id: 'train', label: 'le train' }, { id: 'station', label: 'la gare' }], right: [{ id: 'zug', label: 'der Zug' }, { id: 'bahnhof', label: 'der Bahnhof' }], correct: { train: 'zug', station: 'bahnhof' } },
    { id: 'ranking', type: 'ranking', prompt: 'Mettez le voyage dans l’ordre.', options: [{ id: 'arrive', label: 'Ankommen' }, { id: 'leave', label: 'Abfahren' }], correctOrder: ['leave', 'arrive'] },
    { id: 'reflect', type: 'text', prompt: 'Où aimeriez-vous aller ?' },
  ];
  const publish = await page.request.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: { homework: questions.map((interaction) => ({ id: interaction.id, kind: 'quiz', interaction })) } });
  expect(publish.status()).toBe(200);
  const { token } = await (await page.request.post(`/api/tutoring/contexts/${contextId}/links`, { headers: CSRF, data: {} })).json();
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await learner.goto(`/host/#/learn?token=${token}`);
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  const practice = learner.locator('section').filter({ has: learner.getByRole('heading', { name: 'Practice', exact: true }) });
  await practice.getByRole('button', { name: 'Zürich', exact: true }).click();
  await practice.getByRole('button', { name: 'Genève', exact: true }).click();
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Correct.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();

  await practice.getByRole('textbox', { name: 'Your answer', exact: true }).fill('ete');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Compare your answer.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Try again', exact: true }).click();
  await practice.getByRole('textbox', { name: 'Your answer', exact: true }).fill('ÉTÉ');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Correct.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();

  await practice.getByRole('textbox', { name: 'Gap 1', exact: true }).fill('komme');
  await practice.getByRole('textbox', { name: 'Gap 2', exact: true }).fill('Österreich');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Correct.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();

  await practice.getByRole('combobox', { name: 'Match le train', exact: true }).click();
  await learner.getByRole('option', { name: 'der Zug', exact: true }).click();
  await practice.getByRole('combobox', { name: 'Match la gare', exact: true }).click();
  await learner.getByRole('option', { name: 'der Bahnhof', exact: true }).click();
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Correct.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();

  await practice.getByRole('button', { name: 'Move Abfahren up', exact: true }).click();
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('Correct.', { exact: true })).toBeVisible();
  await practice.getByRole('button', { name: 'Good', exact: true }).click();

  await practice.getByRole('textbox', { name: 'Your answer', exact: true }).fill('Je voudrais aller à Bâle.');
  await practice.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(practice.getByText('How did that feel?', { exact: true })).toBeVisible();
  await learner.screenshot({ path: testInfo.outputPath('homework-reflection.png'), fullPage: true });
  await practice.getByRole('button', { name: 'Confident', exact: true }).click();
  await expect(practice).toHaveCount(0);
  await learner.reload();
  await expect(learner.getByRole('heading', { name: 'Camille', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(practice).toHaveCount(0);
  expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await learner.close();
});
