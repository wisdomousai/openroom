/**
 * UC-06 — The library: find one deck among many and act on it.
 *
 * Tree rail → select → rename inline → drag to another folder → take the
 * panel's primary action. All of that happens on one screen without a route
 * change, which is the claim the three-column library makes.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { waitForWorker } from '../fixtures/session';

const BASE = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

const CSRF = { 'x-openroom-csrf': '1', 'content-type': 'application/json' };

/** Sign in through the demo account and keep the cookie on the page context. */
async function signIn(page: Page): Promise<APIRequestContext> {
  const api = page.request;
  const res = await api.post(`${BASE}/api/auth/demo/login`, {
    headers: CSRF,
    data: { username: 'alice', password: 'demo' },
  });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);

  /*
   * `or_session` is minted `Secure`, which is correct in production and
   * useless against a dev worker served over plain http: Chromium accepts the
   * cookie but never sends it back. Re-add the same cookie without the flag so
   * the journey exercises the real session path instead of a test-only bypass
   * in the worker.
   */
  const context = page.context();
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));

  return api;
}

interface Seed {
  spaceId: string;
  fromFolderId: string;
  fromFolderName: string;
  toFolderId: string;
  toFolderName: string;
  deckTitle: string;
}

async function seedLibrary(api: APIRequestContext): Promise<Seed> {
  const spaces = await (await api.get(`${BASE}/api/my/spaces`)).json();
  const spaceId: string = spaces.spaces[0].id;

  const stamp = Date.now();
  const mkFolder = async (name: string): Promise<string> => {
    const res = await api.post(`${BASE}/api/my/spaces/${spaceId}/folders`, {
      headers: CSRF,
      data: { name },
    });
    return (await res.json()).id as string;
  };
  const fromFolderName = `Week A ${stamp}`;
  const toFolderName = `Week B ${stamp}`;
  const fromFolderId = await mkFolder(fromFolderName);
  const toFolderId = await mkFolder(toFolderName);

  const deckTitle = `Passé composé ${stamp}`;
  await api.post(`${BASE}/api/decks`, {
    headers: CSRF,
    data: { title: deckTitle, spaceId, folderId: fromFolderId },
  });

  return { spaceId, fromFolderId, fromFolderName, toFolderId, toFolderName, deckTitle };
}

test.beforeAll(async () => {
  await waitForWorker();
});

test.describe('UC-06 library', () => {
  test('tree → select → rename → move → primary action', async ({ page }) => {
    const api = await signIn(page);
    const seed = await seedLibrary(api);

    await page.goto(`${BASE}/host/#/space/${seed.spaceId}`);

    const rail = page.getByRole('navigation', { name: 'Folder tree' });
    await expect(rail).toBeVisible();
    await rail.getByRole('button', { name: seed.fromFolderName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`folderId=${seed.fromFolderId}`));

    const row = page.getByRole('option', { name: new RegExp(seed.deckTitle) });
    await expect(row).toBeVisible();

    await row.click();
    const panel = page.getByRole('complementary', { name: /details$/ });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/itemId=/);

    const renamed = `${seed.deckTitle} revised`;
    await panel.getByRole('button', { name: `Rename ${seed.deckTitle}` }).click();
    const renameBox = panel.getByLabel('Rename');
    await renameBox.fill(renamed);
    await renameBox.press('Enter');
    await expect(panel.getByRole('button', { name: `Rename ${renamed}` })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Save$/ })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Move to another folder…', exact: true }).click();
    await panel.getByLabel('Filter folders').fill(seed.toFolderName);
    await panel.getByRole('button', { name: seed.toFolderName, exact: true }).click();

    await expect(page.getByRole('option', { name: new RegExp(renamed) })).toHaveCount(0);
    await rail.getByRole('button', { name: seed.toFolderName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`folderId=${seed.toFolderId}`));
    const movedRow = page.getByRole('option', { name: new RegExp(renamed) });
    await expect(movedRow).toBeVisible();

    await movedRow.dragTo(rail.getByRole('button', { name: seed.fromFolderName, exact: true }));
    await expect(page.getByRole('option', { name: new RegExp(renamed) })).toHaveCount(0);
    await rail.getByRole('button', { name: seed.fromFolderName, exact: true }).click();
    const backRow = page.getByRole('option', { name: new RegExp(renamed) });
    await expect(backRow).toBeVisible();

    await backRow.click();
    const primary = page
      .getByRole('complementary', { name: /details$/ })
      .getByRole('link')
      .first();
    await expect(primary).toHaveText('Open');
  });
});
