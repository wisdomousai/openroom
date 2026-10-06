import { test, expect, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { writeOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { launchDesktop } from '../desktop';
import { waitForWorker } from '../fixtures/session';
import type { Outline } from '../../packages/schema/src/outline-types';

const CSRF = { 'x-openroom-csrf': '1' };
const emptyQuestion = (): Outline => ({ version: 1, meta: { title: 'Unfinished deck' }, steps: [{ id: 'question', kind: 'interaction', interactionId: 'q' }], interactions: [{ id: 'q', type: 'choice', prompt: '', options: [{ id: 'a', label: '' }, { id: 'b', label: '' }] }] });
test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

async function openDeck(page: Page, content: Outline) {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const response = await page.request.post('/api/decks', { headers: CSRF, data: { content } });
  expect(response.status(), await response.text()).toBe(201);
  const { deck } = await response.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await expect(page.locator('.slide-canvas__frame')).toBeVisible();
  return deck.id as string;
}

async function saved(page: Page) {
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
}

test('question hints stay empty and unused options never enter the saved deck', async ({ page }) => {
  const deckId = await openDeck(page, { version: 1, meta: { title: 'Questions' }, steps: [{ id: 's', kind: 'blank' }], interactions: [] });
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.getByRole('button', { name: 'Question', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const prompt = dialog.getByLabel('Question', { exact: true });
  await expect(prompt).toHaveValue('');
  await expect(prompt).toHaveAttribute('placeholder', 'Ask the class something');
  await expect(dialog.getByLabel('Option 2', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await prompt.fill('   ');
  await dialog.getByLabel('Option 1', { exact: true }).fill('Yes');
  await dialog.getByLabel('Option 2', { exact: true }).fill('No');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await prompt.fill('Are you ready?');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.locator('.slide-canvas__frame [data-part^="option-"]')).toHaveCount(2);
  await saved(page);
  const draft = await (await page.request.get(`/api/decks/${deckId}/draft`)).json();
  const outline = parse(draft.source) as Outline;
  expect(outline.interactions[0]).toMatchObject({ prompt: 'Are you ready?', options: [{ label: 'Yes' }, { label: 'No' }] });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
});

test('empty fields reload, can be cleared again, and cannot start a live question', async ({ page }, testInfo) => {
  const outline = emptyQuestion();
  const deckId = await openDeck(page, outline);
  const frame = page.locator('.slide-canvas__frame');
  const prompt = frame.locator('[data-part="header"]');
  await expect(prompt).toHaveText('');
  expect(await prompt.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('Ask the class something');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
  const rejected = await page.request.post('/api/sessions', { headers: CSRF, data: { outline } });
  expect(rejected.status()).toBe(422);
  const session = await page.request.post('/api/sessions', { headers: CSRF, data: { deckId, deckVersion: 1, title: outline.meta.title } });
  expect(session.status(), await session.text()).toBe(201);
  const { session: created } = await session.json();
  const launch = await page.request.post(`/api/sessions/${created.id}/launch`, { headers: CSRF, data: { start: true, version: 1 } });
  expect(launch.status(), await launch.text()).toBe(422);

  await prompt.fill('What changed?');
  await prompt.press('Tab');
  const first = frame.locator('[data-part="option-0"]');
  await first.fill('The colour');
  await first.press('Tab');
  await frame.locator('[data-part="option-1"]').fill('The shape');
  await frame.locator('[data-part="option-1"]').press('Tab');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
  await first.fill('');
  await first.press('Tab');
  await saved(page);
  await page.reload();
  await expect(first).toHaveText('');
  await expect(prompt).toHaveText('What changed?');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('empty-answer-draft.png') });
});

test('matching pairs require entered words and token labels start empty', async ({ page }) => {
  await openDeck(page, { version: 1, meta: { title: 'Matching' }, steps: [{ id: 's', kind: 'blank' }], interactions: [] });
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.getByRole('button', { name: 'Question', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Match', exact: true }).click();
  await dialog.getByLabel('Question', { exact: true }).fill('Match the words');
  for (const [label, value] of [['Word 1', 'chien'], ['Meaning 1', 'dog'], ['Word 2', 'chat']]) await dialog.getByLabel(label!, { exact: true }).fill(value!);
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await dialog.getByLabel('Meaning 2', { exact: true }).fill('cat');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await saved(page);
  await page.goto('/host/#/settings/tokens/new');
  await expect(page.getByLabel('Label', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Create token', exact: true })).toBeDisabled();
});

test('text-box watermarks remain editor-only after saving and presenting', async ({ page }) => {
  await openDeck(page, { version: 1, meta: { title: 'Text box' }, interactions: [], steps: [{ id: 's', kind: 'blank', elements: [{ id: 'text', type: 'text', text: '', box: { x: 10, y: 10, w: 60, h: 20 } }] }] });
  const box = page.locator('.slide-canvas__frame [data-part="el-text"]');
  await expect(box).toHaveText('');
  expect(await box.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('Text box');
  await box.fill('Written text');
  await box.press('Tab');
  await saved(page);
  await box.fill('');
  await box.press('Tab');
  await saved(page);
  await page.reload();
  await expect(box).toHaveText('');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter.locator('[data-part="el-text"]').first()).toHaveText('');
  await expect(presenter.locator('[data-placeholder]')).toHaveCount(0);
});

test('Desktop saves unfinished fields and scrolls homework independently', async ({}, testInfo) => {
  test.skip(process.env.RUN_DESKTOP_JOURNEY !== '1', 'Requires the built desktop app.');
  const directory = await mkdtemp('/tmp/or-drafts-');
  const path = join(directory, 'draft.openroom');
  const outline = emptyQuestion();
  outline.homework = { tasks: Array.from({ length: 10 }, (_, i) => ({ id: `read-${i}`, kind: 'reading', body: '' })) };
  await writeOpenRoomPackage(path, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: '17d71b36-4b7d-4cc4-8c50-143b9e8c2aaa', localRevision: 0, outline }), directory);
  const app = await launchDesktop(join(directory, 'profile'), path);
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.slide-canvas__frame [data-part="header"]')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /^Homework / }).click();
    const homework = page.getByRole('region', { name: 'Homework document' });
    await homework.getByRole('button', { name: 'Add writing', exact: true }).click();
    await expect(homework.locator('[data-homework-task]').last().locator('input')).toBeFocused();
    await expect(homework.getByLabel('writing prompt')).toHaveValue('');
    await homework.getByLabel('writing prompt').fill('Describe the change.');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await saved(page);
    await page.reload();
    await page.getByRole('button', { name: /^Homework / }).click();
    await expect(homework.getByLabel('writing prompt')).toHaveValue('Describe the change.');
    await homework.getByLabel('writing prompt').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('desktop-homework.png') });
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
});
