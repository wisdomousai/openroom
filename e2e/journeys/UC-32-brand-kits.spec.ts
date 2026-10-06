import { test, expect } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { facilitatorAccounts } from '../fixtures/facilitators';
import { waitForWorker } from '../fixtures/session';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test('creates a branded master, applies a kit to a deck and keeps that copy after editing and trashing the kit', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = facilitatorAccounts({ branding: true });
  let assetId: string | undefined;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await accounts.owner.signIn(page.context());
    const space = await (await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Northstar learning', experience: 'training' } })).json();
    await page.goto(`/host/#/space/${space.id}/edit`);
    await page.getByRole('link', { name: 'Open brand kits', exact: true }).click();
    await page.getByRole('link', { name: 'New brand kit', exact: true }).click();
    await page.getByLabel('Kit name', { exact: true }).fill('Northstar workshops');
    await page.getByLabel('Accent color', { exact: true }).fill('#eeeeee');
    await expect(page.getByRole('button', { name: 'Save brand kit', exact: true })).toBeDisabled();
    await expect(page.getByText('Improve contrast before saving', { exact: true })).toBeVisible();
    await page.getByLabel('Accent color', { exact: true }).fill('#6d358b');
    await page.getByRole('combobox', { name: 'heading font', exact: true }).click();
    await page.getByRole('option', { name: 'Serif', exact: true }).click();
    await page.getByLabel('Footer', { exact: true }).fill('Northstar · Learn together');
    await page.getByLabel('Footer', { exact: true }).blur();
    await page.getByRole('button', { name: 'Gradient', exact: true }).click();
    await page.getByLabel('Gradient start', { exact: true }).fill('#ffffff');
    await page.getByLabel('Gradient end', { exact: true }).fill('#efe7f5');
    // A tiny valid PNG exercises the real upload/asset path without external network images.
    const upload = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/assets`) && response.request().method() === 'POST');
    await page.getByLabel('Logo image file', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    const uploaded = await (await upload).json(); assetId = uploaded.id ?? uploaded.asset?.id;
    await page.getByLabel('Logo description', { exact: true }).fill('Northstar logo');
    await page.getByLabel('Logo description', { exact: true }).blur();
    await page.getByRole('button', { name: 'Save brand kit', exact: true }).click();
    await expect(page).toHaveURL(/brand-kits\/[a-f0-9-]{36}$/);
    const kitId = page.url().split('/').at(-1)!;
    const savedKit = await page.request.get(`/api/tutoring/brand-kits/${kitId}`);
    expect(savedKit.status()).toBe(200);
    const kit = (await savedKit.json()).brandKit;
    expect(kit.design.theme.fonts.heading).toBe('serif');
    expect(kit.design.masters[0].logo.assetId).toBe(assetId);
    await page.screenshot({ path: testInfo.outputPath('brand-kit.png'), fullPage: true });
    await page.mouse.move(900, 500);
    await page.mouse.wheel(0, 700);
    await expect(page.getByLabel('Chart palette preview', { exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Move to trash', exact: true })).toBeInViewport();
    const original = defaultDeckDesign('paper');
    const created = await page.request.post('/api/decks', { headers: CSRF, data: { spaceId: space.id, content: {
      version: 1, meta: { title: 'Clear next steps' }, design: original, interactions: [],
      steps: [{ id: 'welcome', kind: 'statement', title: 'Clear next steps', body: 'What will you put into practice?', design: { hideMasterDecorations: true, background: { kind: 'solid', color: '#ff0000' } } }],
    } } });
    expect(created.status()).toBe(201);
    const { deck } = await created.json();
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('combobox', { name: 'Choose brand kit', exact: true }).click();
    await page.getByRole('option', { name: 'Northstar workshops', exact: true }).click();
    await page.getByRole('button', { name: 'Apply to all slides', exact: true }).click();
    const surface = page.locator('.slide-canvas__frame .slide-surface');
    await expect(surface).toHaveAttribute('data-slide-theme', 'business');
    await expect(surface.getByText('Northstar · Learn together', { exact: true })).toBeVisible();
    await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
    const saved = parseYaml((await (await page.request.get(`/api/decks/${deck.id}/draft`)).json()).source);
    expect(saved.design).toEqual(kit.design);
    expect(saved.steps[0].design).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('branded-deck.png') });
    await page.goto(`/host/#/space/${space.id}/brand-kits/${kitId}/edit`);
    await page.getByLabel('Footer', { exact: true }).fill('Changed kit footer');
    await page.getByLabel('Footer', { exact: true }).blur();
    await page.getByRole('button', { name: 'Save brand kit', exact: true }).click();
    await expect(page).toHaveURL(/brand-kits\/[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await page.getByRole('link', { name: /Northstar workshops/ }).click();
    await page.getByRole('button', { name: 'Restore brand kit', exact: true }).click();
    await expect(page.getByRole('link', { name: /Northstar workshops/ })).toBeVisible();
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    await expect(surface.getByText('Northstar · Learn together', { exact: true })).toBeVisible();
    await expect(surface.getByText('Changed kit footer', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (assetId) await page.request.delete(`/api/tutoring/assets/${assetId}`, { headers: CSRF });
    accounts.cleanup();
  }
});
