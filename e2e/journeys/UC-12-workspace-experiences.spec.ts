import { test, expect } from '@playwright/test';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('choose an experience, open its sample, and return to the same place', async ({ page }, testInfo) => {
  const login = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  expect(login.status()).toBe(200);
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));

  for (const experience of ['tutoring', 'classroom', 'training'] as const) {
    await page.goto('/host/#/space/new');
    const name = `${experience} ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Space name' }).fill(name);
    await page.getByRole('radio', { name: new RegExp(`^${experience}`, 'i') }).check();
    await page.getByRole('button', { name: 'Create space', exact: true }).click();
    await expect(page).toHaveURL(/#\/space\/(?!new$)[^/?]+$/);
    const spaceId = /#\/space\/([^/?]+)/.exec(page.url())![1]!;
    const shell = page.locator('[data-workspace-experience]');
    await expect(shell).toHaveAttribute('data-workspace-experience', experience);
    await expect(page.getByRole('button', { name: 'Switch space' })).toContainText(name);
    const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
    if (experience === 'tutoring') await expect(nav.getByRole('link', { name: 'Add student or group' })).toBeVisible();
    if (experience === 'classroom') await expect(nav.getByRole('link', { name: 'Add class' })).toBeVisible();
    if (experience === 'training') await expect(nav.getByRole('link', { name: /^Add (student|class)/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${experience}-library.png`) });
    await page.reload();
    await expect(shell).toHaveAttribute('data-workspace-experience', experience);
    await page.getByRole('button', { name: 'Open sample deck' }).click();
    await expect(page).toHaveURL(/#\/decks\/[^/]+\/edit$/);
    const deckId = /decks\/([^/]+)\/edit/.exec(page.url())![1]!;
    const detail = await (await page.request.get(`/api/decks/${deckId}`)).json();
    expect(detail.deck.spaceId).toBe(spaceId);
    expect(detail.deck.contextId).toBeNull();
    expect(detail.content.steps).toHaveLength(5);
    await page.getByRole('link', { name: 'Back', exact: true }).click();
    await expect(shell).toHaveAttribute('data-workspace-experience', experience);
    await expect(page.getByRole('option', { name: new RegExp(detail.deck.title) })).toBeVisible();
    await page.getByRole('button', { name: 'Switch space' }).click();
    await page.getByRole('menuitem', { name: 'Space settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Space settings', exact: true })).toBeVisible();
    const changed = experience === 'training' ? 'tutoring' : 'training';
    await page.getByRole('radio', { name: new RegExp(`^${changed}`, 'i') }).check();
    await page.getByRole('button', { name: 'Save experience' }).click();
    await expect(shell).toHaveAttribute('data-workspace-experience', changed);
    await page.reload();
    await expect(shell).toHaveAttribute('data-workspace-experience', changed);
    const unchanged = await (await page.request.get(`/api/decks/${deckId}`)).json();
    expect(unchanged.content).toEqual(detail.content);
  }
});
