import { test, expect, type Page } from '@playwright/test';
import { encodeVoiceWav } from '../../packages/schema/src/voice-audio.js';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
async function chooseLanguage(page: Page, name: string) {
  await page.getByRole('combobox', { name: /Interface language|Langue de l’interface|Sprache der Oberfläche/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('French and German controls preserve writing, practice and audio while lesson content stays authored', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Français A2', kind: 'group', experience: 'tutoring' } })).json();
  const content = { version: 1, meta: { title: 'Le prochain voyage' }, steps: [{ id: 'title', kind: 'title', title: 'Le prochain voyage' }], interactions: [] };
  const { deck, session } = await (await page.request.post('/api/decks', { headers: CSRF, data: { contextId: context.id, spaceId: context.spaceId, createSession: true, content } })).json();
  expect((await page.request.post(`/api/sessions/${session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  const homework = [
    { id: 'writing', kind: 'writing', prompt: 'Décrivez votre prochain voyage.' },
    { id: 'voice', kind: 'voice', prompt: 'Présentez votre destination.' },
    { id: 'practice', kind: 'quiz', interaction: { id: 'gap', type: 'fill-the-gaps', prompt: 'Je {{aller}} à Paris.', gaps: [{ id: 'aller', answers: ['vais'] }] } },
  ];
  expect((await page.request.put(`/api/sessions/${session.id}/record`, { headers: CSRF, data: { homework } })).status()).toBe(200);
  const { token } = await (await page.request.post(`/api/tutoring/contexts/${context.id}/links`, { headers: CSRF, data: { displayName: 'Léa' } })).json();
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'fr-CH' });
  await learner.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await learner.goto(`/host/#/learn?token=${token}`);
  await expect(learner.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(learner.getByRole('tab', { name: 'Cours', exact: true })).toBeVisible();
  const writing = learner.getByLabel('Décrivez votre prochain voyage.', { exact: true });
  await writing.fill('Je vais à Paris.');
  await chooseLanguage(learner, 'Deutsch');
  await expect(writing).toHaveValue('Je vais à Paris.');
  await learner.route('**/api/learner/writing', (route) => route.fulfill({ status: 409, json: { error: 'assignment-changed' } }));
  await learner.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(learner.getByRole('alert')).toContainText('Kopiere deinen Text');
  await chooseLanguage(learner, 'Français');
  await expect(learner.getByRole('alert')).toContainText('Copiez votre texte');
  await expect(writing).toHaveValue('Je vais à Paris.');
  await learner.unroute('**/api/learner/writing');
  await learner.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Enregistré', exact: true })).toBeVisible();

  await learner.getByRole('tab', { name: 'Exercices', exact: true }).click();
  await learner.getByRole('textbox', { name: 'Trou 1', exact: true }).fill('vais');
  await chooseLanguage(learner, 'Deutsch');
  await expect(learner.getByRole('textbox', { name: 'Lücke 1', exact: true })).toHaveValue('vais');
  await learner.getByRole('button', { name: 'Prüfen', exact: true }).click();
  await expect(learner.getByText('Richtig.', { exact: true })).toBeVisible();
  await learner.screenshot({ path: testInfo.outputPath('german-practice-phone.png'), fullPage: true });
  await learner.getByRole('button', { name: 'Verstanden', exact: true }).click();
  await learner.getByRole('tab', { name: 'Lektion', exact: true }).click();
  await learner.getByRole('button', { name: 'Antwort aufnehmen', exact: true }).click();
  await expect(learner.getByRole('alert')).toContainText('Mikrofon ist nicht verfügbar');
  await chooseLanguage(learner, 'Français');
  await expect(learner.getByRole('alert')).toContainText('microphone n’est pas disponible');
  const samples = new Float32Array(16_000).fill(0.1);
  await learner.getByLabel('Choisir un fichier audio', { exact: true }).setInputFiles({ name: 'reponse.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeVoiceWav(samples)) });
  await expect(learner.getByLabel('Écouter votre réponse', { exact: true })).toHaveJSProperty('duration', 1);
  await learner.screenshot({ path: testInfo.outputPath('french-lesson-phone.png'), fullPage: true });
  await chooseLanguage(learner, 'Deutsch');
  await expect(learner.getByLabel('Deine Antwort anhören', { exact: true })).toHaveJSProperty('duration', 1);
  await learner.getByRole('button', { name: 'Antwort senden', exact: true }).click();
  await expect(learner.getByText('Antwort gesendet', { exact: true })).toBeVisible();
  const { work } = await (await page.request.get(`/api/tutoring/contexts/${context.id}/work`)).json();
  const response = work.find((row: { task: { kind: string } }) => row.task.kind === 'writing');
  expect((await page.request.put(`/api/tutoring/contexts/${context.id}/work/${response.id}/feedback`, { headers: CSRF, data: {
    version: 0, action: 'publish', feedback: { message: 'Votre phrase est claire.', corrections: [] },
  } })).status()).toBe(200);
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Votre phrase est claire.', { exact: true })).toBeVisible();
  await learner.getByRole('tabpanel', { name: 'Feedback', exact: true }).getByText('Deine Antwort', { exact: true }).click();
  await expect(learner.getByRole('tabpanel', { name: 'Feedback', exact: true }).getByText('Je vais à Paris.', { exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Lektion', exact: true }).click();
  await learner.getByRole('button', { name: 'Aufnahme entfernen', exact: true }).click();
  const dialog = learner.getByRole('dialog');
  await expect(dialog).toHaveAttribute('lang', 'de');
  await expect(dialog.getByRole('button', { name: 'Schliessen', exact: true })).toBeVisible();
  await learner.screenshot({ path: testInfo.outputPath('german-audio-dialog-phone.png') });
  await dialog.getByRole('button', { name: 'Audio in den Papierkorb', exact: true }).click();
  await learner.getByRole('button', { name: 'Aufnahme wiederherstellen', exact: true }).click();
  await expect(learner.getByRole('button', { name: 'Anhören · 0:01', exact: true })).toBeVisible();
  await learner.reload();
  await expect(learner.locator('html')).toHaveAttribute('lang', 'de');
  await expect(writing).toHaveValue('Je vais à Paris.');
  await expect(learner.locator('body')).toHaveJSProperty('scrollWidth', 390);
  const storage = await learner.evaluate(() => ({ ...localStorage }));
  expect(storage['openroom.learner.interface-language']).toBe('de');
  expect(JSON.stringify(storage)).not.toContain(token);
  expect(JSON.stringify(storage)).not.toContain('Je vais à Paris.');
  await chooseLanguage(learner, 'English');
  await expect(learner.getByRole('tab', { name: 'Lesson', exact: true })).toBeVisible();
  await expect(learner.getByText('Le prochain voyage', { exact: true })).toBeVisible();
  const unchanged = await (await page.request.get(`/api/decks/${deck.id}`)).json();
  expect(unchanged.content).toEqual(content);
  await learner.close();
});

test('link errors use the selected language even when preference storage is blocked', async ({ browser }) => {
  const learner = await browser.newPage({ locale: 'fr-FR' });
  await learner.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await learner.goto('/host/#/learn');
  await expect(learner.getByRole('heading', { name: 'Ce lien ne fonctionne plus', exact: true })).toBeVisible();
  await chooseLanguage(learner, 'Deutsch');
  await expect(learner.getByRole('heading', { name: 'Dieser Link funktioniert nicht mehr', exact: true })).toBeVisible();
  await learner.route('**/api/learner/me', (route) => route.fulfill({ status: 429, json: { error: 'rate-limit' } }));
  await learner.evaluate(() => { location.hash = '/learn?token=orlnk_language-test'; });
  await expect(learner.getByRole('heading', { name: 'Zu viele Versuche', exact: true })).toBeVisible();
  await chooseLanguage(learner, 'English');
  await expect(learner.getByRole('heading', { name: 'Too many attempts', exact: true })).toBeVisible();
  await learner.close();
});
