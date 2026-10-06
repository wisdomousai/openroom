import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('tutor publishes shared and individual tasks without exposing other learners or private notes', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Conversation en français', kind: 'group', experience: 'tutoring' } })).json();
  const { deck, session } = await (await page.request.post('/api/decks', { headers: CSRF, data: { contextId: context.id, spaceId: context.spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Le prochain voyage' }, steps: [{ id: 'title', kind: 'title', title: 'Le prochain voyage' }],
      interactions: [{ id: 'practice', type: 'text', prompt: 'Complétez : je ___ à Paris.', correctAnswers: ['vais'] }],
      homework: { tasks: [
        { id: 'reading', kind: 'reading', title: 'Lecture commune', body: 'Lisez le dialogue du voyage.' },
        { id: 'writing', kind: 'writing', title: 'Écrire', prompt: 'Décrivez votre prochain voyage.' },
        { id: 'voice', kind: 'voice', title: 'Parler', prompt: 'Présentez votre destination.' },
        { id: 'practice', kind: 'quiz', title: 'Pratiquer', interactionId: 'practice' },
      ] },
    },
  } })).json();
  expect((await page.request.post(`/api/sessions/${session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  const mint = async (displayName: string) => (await (await page.request.post(`/api/tutoring/contexts/${context.id}/links`, { headers: CSRF, data: { displayName } })).json()).token as string;
  const lea = await mint('Léa'); const noor = await mint('Noor');
  const notesUrl = `/host/#/sessions/${session.id}/record`;
  await page.goto(notesUrl);
  await page.getByLabel('Tutor notes', { exact: true }).fill('PRIVATE TUTOR OBSERVATION');
  await page.getByLabel('Next step', { exact: true }).fill('PRIVATE NEXT LESSON');
  await page.getByLabel('Outcomes (one per line)', { exact: true }).fill('Nous avons préparé un voyage.');
  for (const [title, learner] of [['Écrire', 'Léa'], ['Parler', 'Noor'], ['Pratiquer', 'Léa']]) {
    const task = page.getByRole('group', { name: `${title} assignment`, exact: true });
    await task.getByRole('combobox', { name: 'Who receives this task?', exact: true }).click();
    await page.getByRole('option', { name: 'Selected learners', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save notes', exact: true })).toBeDisabled();
    await task.getByRole('checkbox', { name: learner, exact: true }).check();
  }
  await page.getByRole('group', { name: 'Parler assignment', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('individual-task-recipients.png') });
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page).toHaveURL(/#\/space\//);
  const record = (await (await page.request.get(`/api/sessions/${session.id}/record`)).json()).record;
  expect(Object.keys(record.homeworkAudience).sort()).toEqual(['practice', 'voice', 'writing']);
  expect(record.homeworkRevision).toBe(1);
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await learner.goto(`/host/#/learn?token=${lea}`);
  await expect(learner.getByRole('heading', { name: 'Écrire', exact: true })).toBeVisible();
  await expect(learner.getByText('Lisez le dialogue du voyage.', { exact: true })).toBeVisible();
  await expect(learner.getByRole('heading', { name: 'Parler', exact: true })).toHaveCount(0);
  await expect(learner.getByText('PRIVATE TUTOR OBSERVATION')).toHaveCount(0);
  await expect(learner.getByText('PRIVATE NEXT LESSON')).toHaveCount(0);
  await learner.getByLabel('Décrivez votre prochain voyage.', { exact: true }).fill('Je vais visiter Paris.');
  await learner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(learner.getByText('Complétez : je ___ à Paris.', { exact: true }).first()).toBeVisible();
  await learner.evaluate((token) => { location.hash = `/learn?token=${token}`; }, noor);
  await expect(learner.getByRole('heading', { name: 'Noor', exact: true })).toBeVisible();
  await expect(learner.getByRole('heading', { name: 'Parler', exact: true })).toBeVisible();
  await expect(learner.getByRole('heading', { name: 'Écrire', exact: true })).toHaveCount(0);
  await learner.screenshot({ path: testInfo.outputPath('individual-homework-phone.png'), fullPage: true });
  await learner.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect(learner.getByText('Your practice is done for now. Return later to practise again.')).toBeVisible();
  await page.goto(notesUrl);
  const writing = page.getByRole('group', { name: 'Écrire assignment', exact: true });
  await expect(writing.getByRole('checkbox', { name: 'Léa', exact: true })).toBeChecked();
  await expect(writing.getByRole('checkbox', { name: 'Noor', exact: true })).not.toBeChecked();
  await writing.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Everyone in this context', exact: true }).click();
  await writing.getByLabel('Instructions', { exact: true }).fill('Décrivez votre prochain voyage en train.');
  await page.getByRole('button', { name: 'Update notes', exact: true }).click();
  await expect(page).toHaveURL(/#\/space\//);
  await learner.reload();
  await expect(learner.getByRole('heading', { name: 'Écrire', exact: true })).toBeVisible();
  const work = (await (await page.request.get(`/api/tutoring/contexts/${context.id}/work`)).json()).work;
  expect(work[0].task.prompt).toBe('Décrivez votre prochain voyage.');
  expect(work[0].body).toBe('Je vais visiter Paris.');
  const source = await (await page.request.get(`/api/decks/${deck.id}`)).text();
  expect(source).not.toContain('homeworkAudience');
  expect(source).not.toContain(record.homeworkAudience.writing[0]);
  await learner.close();
});
