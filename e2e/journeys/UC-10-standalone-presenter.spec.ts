import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('blank deck → current draft → present → participate → return → download', async ({ page }, testInfo) => {
  const login = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  expect(login.status()).toBe(200);
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  await page.goto('/host/#/decks/new');
  await expect(page).toHaveURL(/#\/decks\/[^/]+\/edit$/);
  const id = /decks\/([^/]+)\/edit/.exec(page.url())![1]!;
  await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(1);
  const detail = await (await page.request.get(`/api/decks/${id}`)).json();
  expect(detail.deck.contextId).toBeNull();
  const title = `Presentation ${Date.now()}`;
  await page.getByRole('button', { name: 'Rename deck', exact: true }).click();
  await page.getByRole('textbox', { name: 'Deck title' }).fill(title);
  await page.getByRole('textbox', { name: 'Deck title' }).press('Enter');
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  const content = { version: 1, meta: { title }, interactions: [], steps: [
    { id: 'opening', kind: 'title', title: 'Opening' },
    { id: 'rules', kind: 'steps', title: 'Three rules', items: ['First rule', 'Second rule', 'Third rule'], reveal: [['header'], ['cell-0'], ['cell-1'], ['cell-2']] },
  ] };
  const draft = await page.request.put(`/api/decks/${id}/draft`, { headers: CSRF, data: { source: JSON.stringify(content), baseVersion: detail.deck.currentVersion } });
  expect(draft.status()).toBe(200);
  await page.reload();
  await page.locator('[data-deck-present]').click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(presenter.getByText(/reveal 2\/4/)).toBeVisible();
  await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(presenter.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
  await expect(presenter.locator('.stage-mirror [data-part="cell-0"]')).toBeVisible();
  await expect(presenter.locator('.stage-mirror [data-part="cell-1"]')).toHaveCount(0);
  await presenter.locator('.stage-mirror').click();
  await page.keyboard.press('ArrowRight');
  await expect(presenter.locator('.stage-mirror [data-part="cell-1"]')).toBeVisible();
  const firstRule = presenter.locator('.stage-mirror [data-part="cell-0"]');
  const phrase = await firstRule.locator('p').evaluate((node) => ({ width: node.clientWidth, content: node.scrollWidth, height: node.clientHeight, contentHeight: node.scrollHeight }));
  expect(phrase.content).toBeLessThanOrEqual(phrase.width + 2);
  expect(phrase.contentHeight).toBeLessThanOrEqual(phrase.height + 2);
  await page.screenshot({ path: testInfo.outputPath('live-presenter.png') });
  await presenter.getByRole('button', { name: 'Edit deck', exact: true }).click();
  await expect(presenter).toHaveCount(0);
  await expect(page.locator('.slide-canvas__frame [data-part="header"]')).toContainText('Three rules');
  await page.getByRole('tab', { name: 'File', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save a copy/ }).click();
  const download = await downloadPromise;
  const directory = await mkdtemp(join(tmpdir(), 'openroom-downloaded-'));
  const { source } = await readOpenRoomPackage((await download.path())!, directory);
  expect(source).toContain('Second rule');
  expect(source).toContain(title);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('library.png') });
});
