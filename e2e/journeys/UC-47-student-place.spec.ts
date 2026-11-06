/**
 * UC-47 — A student's place in the Library.
 *
 * A tutor opens one student's place and works there without detours: stale
 * addresses land in the Library, a missing student says so, Live now names the
 * student, every list row has a context menu reachable from the keyboard,
 * folders rename in place, trashing a folder takes its decks along, and the
 * purge page names what it deletes.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };

test.beforeAll(async () => { await waitForWorker(); });

async function signIn(page: Page): Promise<APIRequestContext> {
  const res = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);
  // `or_session` is minted Secure; the local worker is plain http.
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  return page.request;
}

async function json<T>(response: Promise<{ status(): number; json(): Promise<unknown> }>, status: number): Promise<T> {
  const res = await response;
  expect(res.status()).toBe(status);
  return await res.json() as T;
}

test('a student place: addresses, menus, rename, folder trash and purge', async ({ page }) => {
  const api = await signIn(page);
  const stamp = Date.now();
  const student = `Mara ${stamp}`;
  const { context } = await json<{ context: { id: string; spaceId: string } }>(
    api.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: student, kind: 'person', experience: 'tutoring' } }), 201);
  const { id: contextId, spaceId } = context;
  const folder = await json<{ id: string }>(api.post(`/api/my/spaces/${spaceId}/folders`, { headers: CSRF, data: { name: 'Verbs' } }), 201);
  await json(api.post(`/api/my/spaces/${spaceId}/folders`, { headers: CSRF, data: { name: 'New folder' } }), 201);
  const filed = await json<{ deck: { id: string } }>(api.post('/api/decks', { headers: CSRF, data: {
    spaceId, contextId, folderId: folder.id,
    content: { version: 1, meta: { title: 'Le passé composé' }, steps: [{ id: 'one', kind: 'title', title: 'Le passé composé' }], interactions: [] },
  } }), 201);
  const loose = await json<{ deck: { id: string }; session: { id: string } }>(api.post('/api/decks', { headers: CSRF, data: {
    spaceId, contextId, createSession: true,
    content: { version: 1, meta: { title: 'Au marché' }, steps: [{ id: 'one', kind: 'title', title: 'Au marché' }], interactions: [] },
  } }), 201);
  await json(api.post(`/api/sessions/${loose.session.id}/launch`, { headers: CSRF, data: { start: true } }), 201);

  // A mistyped hash lands in the Library; the short deck address opens the editor.
  await page.goto('/host/#/nonsense');
  await expect(page).not.toHaveURL(/nonsense/);
  await expect(page.getByRole('listbox', { name: 'Library' }).or(page.getByRole('heading', { name: 'Sample deck' })).first()).toBeVisible();
  await expect(page.getByText('Page not found')).toHaveCount(0);
  await page.goto(`/host/#/decks/${filed.deck.id}`);
  await expect(page).toHaveURL(new RegExp(`#/decks/${filed.deck.id}/edit`));

  // A student that does not exist says so, with a way back.
  await page.goto(`/host/#/space/${spaceId}?contextId=ctx_doesnotexist`);
  await expect(page.getByRole('heading', { name: 'This student is not available' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);

  await page.goto(`/host/#/space/${spaceId}?contextId=${contextId}`);
  const live = page.getByRole('region', { name: 'Live now' });
  await expect(live.getByRole('button', { name: `Rejoin ${student}, Au marché` })).toBeVisible();

  const library = page.getByRole('listbox', { name: 'Library' });
  const verbs = library.getByRole('option', { name: /^Verbs/ });
  const market = library.getByRole('option', { name: /^Au marché/ });

  // Right-click on a deck row offers the deck verbs.
  await market.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Start session', 'Duplicate', 'Move to trash']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Shift+F10 on a focused folder row offers the folder verbs.
  await verbs.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Rename', 'Duplicate', 'Move to trash']);
  await page.keyboard.press('Escape');

  // F2 renames in place, and focus comes back to the row.
  await verbs.focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('textbox', { name: 'Rename Verbs' });
  await expect(rename).toBeFocused();
  await rename.fill('Verbes');
  await rename.press('Enter');
  await expect(library.getByRole('option', { name: /^Verbes/ })).toBeFocused();

  // The menu's Rename keeps the name field focused after the menu closes.
  await library.getByRole('option', { name: /^Verbes/ }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  const again = page.getByRole('textbox', { name: 'Rename Verbes' });
  await expect(again).toBeFocused();
  await page.waitForTimeout(300); // Past the menu's close animation, which used to take focus back.
  await expect(again).toBeFocused();
  await again.fill('Irregular verbs');
  await again.press('Enter');
  const renamed = library.getByRole('option', { name: /^Irregular verbs/ });
  await expect(renamed).toBeFocused();

  // In the rail, F2 renames too, and focus comes back to the rail row.
  const rail = page.getByRole('navigation', { name: 'Folder tree' });
  await rail.getByRole('button', { name: 'Irregular verbs', exact: true }).focus();
  await page.keyboard.press('F2');
  await expect(page.getByRole('textbox', { name: 'Rename folder' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(rail.getByRole('button', { name: 'Irregular verbs', exact: true })).toBeFocused();

  // A new folder's default name does not repeat a sibling's.
  // The rail's create button sits above the tree, before the folder row of the same name.
  await rail.getByRole('button', { name: 'New folder', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'New folder name' })).toHaveValue('New folder 2');
  await page.keyboard.press('Escape');

  // Trashing a folder takes its decks along, and says so before it happens.
  await renamed.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move to trash' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Move folder to trash' });
  await expect(dialog).toContainText('the folders inside it and their decks to Trash');
  await dialog.getByRole('button', { name: 'Move to trash' }).click();
  await expect(renamed).toHaveCount(0);
  const tree = await json<{ decks: { id: string }[] }>(api.get(`/api/my/spaces/${spaceId}`), 200);
  expect(tree.decks.map((deck) => deck.id)).not.toContain(filed.deck.id);

  // The purge page names what goes, in the workspace's own type.
  const { confirmationUrl } = await json<{ confirmationUrl: string }>(
    api.post(`/api/my/folders/${folder.id}/permanent-deletion`, { headers: CSRF }), 202);
  await page.goto(new URL(confirmationUrl).pathname);
  await expect(page.getByText('The decks in them, with those decks’ sessions, Notes and learner work')).toBeVisible();
  await page.getByRole('button', { name: /Permanently delete/ }).click();
  await expect(page.getByText('Permanently deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to Trash' })).toBeVisible();
  expect((await api.get(`/api/decks/${filed.deck.id}`)).status()).toBe(404);
});
