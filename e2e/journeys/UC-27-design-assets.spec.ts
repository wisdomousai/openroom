import { test, expect, type Locator } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { designImage } from '../fixtures/design-images';
import { joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
const loaded = async (image: Locator) => { await expect(image).toBeVisible(); await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0); };
test.beforeAll(async () => { await waitForWorker(); });

test('uploaded branding survives reload, portable download and live delivery', async ({ page, browser }, testInfo) => {
  const background = await designImage(page);
  const logo = await designImage(page, true);
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content: {
    version: 1, meta: { title: 'A shared classroom design' }, interactions: [], steps: [{ id: 'opening', kind: 'title', title: 'Compare the evidence', body: 'Explain your reasoning. Listen for another perspective.' }],
  } } });
  expect(created.status()).toBe(201);
  const { deck } = await created.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'business', exact: true }).click();
  await page.getByLabel('Logo description', { exact: true }).fill('OpenRoom School');
  await page.getByLabel('Logo image file', { exact: true }).setInputFiles({ name: 'school.png', mimeType: 'image/png', buffer: logo });
  const canvas = page.locator('.slide-canvas__frame');
  await loaded(canvas.locator('.slide-surface__logo'));
  await expect(canvas.locator('.slide-surface__logo')).toHaveAttribute('alt', 'OpenRoom School');
  await page.getByLabel('Background image file', { exact: true }).setInputFiles({ name: 'classroom.png', mimeType: 'image/png', buffer: background });
  await loaded(canvas.locator('.slide-surface__background img'));
  await page.getByLabel('x focal point', { exact: true }).press('End');
  await page.getByRole('button', { name: 'New master', exact: true }).click();
  await page.getByRole('button', { name: 'Use on this slide', exact: true }).click();
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  await page.reload();
  await loaded(canvas.locator('.slide-surface__logo'));
  await loaded(canvas.locator('.slide-surface__background img'));
  await expect(canvas.locator('.slide-surface__background img')).toHaveCSS('object-position', '100% 50%');
  await page.screenshot({ path: testInfo.outputPath('branded-editor.png') });
  await page.getByRole('tab', { name: 'File', exact: true }).click();
  const original = await (await page.request.get(`/api/decks/${deck.id}`)).json();
  await page.route('**/api/assets/**', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
  await expect(page.getByText(/could not be included \(HTTP 404\)/)).toBeVisible();
  expect((await (await page.request.get(`/api/decks/${deck.id}`)).json()).deck.currentVersion).toBe(original.deck.currentVersion);
  await page.unroute('**/api/assets/**');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
  const file = await download;
  const directory = await mkdtemp('/tmp/openroom-design-copy-');
  const reopened = await readOpenRoomPackage((await file.path())!, directory);
  expect(Object.keys(reopened.file.resources!)).toHaveLength(2);
  const master = reopened.file.outline.design!.masters[0]!;
  expect(master.background).toMatchObject({ kind: 'image', resourceId: expect.any(String), focal: { x: 100, y: 50 } });
  expect(master.logo).toMatchObject({ resourceId: expect.any(String), alt: 'OpenRoom School' });
  const resources = Object.values(reopened.file.resources!);
  expect(resources.every((resource) => resource.online?.kind === 'openroom-asset')).toBe(true);
  const copies = await Promise.all(resources.map((resource) => readFile(join(directory, resource.path))));
  expect(copies.some((bytes) => bytes.equals(background))).toBe(true);
  expect(copies.some((bytes) => bytes.equals(logo))).toBe(true);
  const launch = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const response = await launch; expect(response.status()).toBe(201);
  const session = await response.json();
  const stage = await browser.newPage(); await stage.goto(stageUrl(session));
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } }); await joinInBrowser(phone, session.code);
  await phone.getByRole('button', { name: 'Slide', exact: true }).click();
  for (const surface of [page.getByRole('dialog', { name: 'Presenter', exact: true }), stage, phone]) {
    await loaded(surface.locator('.slide-surface__logo'));
    await loaded(surface.locator('.slide-surface__background img'));
  }
  await stage.screenshot({ path: testInfo.outputPath('branded-stage.png') });
  await phone.screenshot({ path: testInfo.outputPath('branded-phone.png'), fullPage: true });
  await stage.close(); await phone.close();
});
