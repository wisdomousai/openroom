/**
 * UC-47 — A student's place in the Library.
 *
 * A tutor opens one student's place and works there without detours: stale
 * addresses land in the Library, a missing student says so, Live now names the
 * student, every list row has a context menu reachable from the keyboard,
 * folders rename in place, trashing a folder takes its decks along, and the
 * purge page names what it deletes. At laptop sizes the access links are open,
 * a group keeps its whole name, a long Next session note stays short, the
 * decks scroll with the page, and a student moves to Trash from Edit student
 * and comes back with Restore.
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
  await expect(page.getByText('The decks in them that are in Trash, with those decks’ sessions, Notes and learner work')).toBeVisible();
  await page.getByRole('button', { name: /Permanently delete/ }).click();
  await expect(page.getByText('Permanently deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to Trash' })).toBeVisible();
  expect((await api.get(`/api/decks/${filed.deck.id}`)).status()).toBe(404);
});

test('a student place at laptop sizes: open links, whole group name, page-length deck list, trash and restore', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const api = await signIn(page);
  const stamp = Date.now();

  // A group keeps its whole name in the panel heading, not its first word.
  const groupName = `Noor and Léa ${stamp}`;
  const { context: group } = await json<{ context: { id: string; spaceId: string } }>(
    api.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: groupName, kind: 'group', experience: 'tutoring' } }), 201);
  await page.goto(`/host/#/space/${group.spaceId}?contextId=${group.id}`);
  await expect(page.getByRole('heading', { level: 2, name: groupName, exact: true })).toBeVisible();
  // An empty place shows the sample card as its one empty state.
  await expect(page.getByRole('heading', { name: 'Sample deck', exact: true })).toBeVisible();
  await expect(page.getByText('No decks in this folder')).toHaveCount(0);

  const student = `Inès ${stamp}`;
  const { context } = await json<{ context: { id: string; spaceId: string } }>(
    api.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: student, kind: 'person', experience: 'tutoring', context: { goals: 'Order at a café', notes: 'Prefers speaking. Slow on the subjunctive.' } } }), 201);
  const { id: contextId, spaceId } = context;
  let sessionId = '';
  for (let index = 1; index <= 8; index++) {
    const created = await json<{ session?: { id: string } }>(api.post('/api/decks', { headers: CSRF, data: {
      spaceId, contextId, createSession: index === 1,
      content: { version: 1, meta: { title: `Leçon ${index}` }, steps: [{ id: 'one', kind: 'title', title: `Leçon ${index}` }], interactions: [] },
    } }), 201);
    if (created.session) sessionId = created.session.id;
  }
  const longNote = `Start with the café role-play. ${'Then review the subjunctive with the drills from last week and ask for three examples of her own. '.repeat(14)}`;
  await json(api.put(`/api/sessions/${sessionId}/record`, { headers: CSRF, data: { outcomes: [], notes: '', homework: [], artifacts: [], nextNote: longNote } }), 200);

  await page.goto(`/host/#/space/${spaceId}?contextId=${contextId}`);
  await expect(page.getByRole('heading', { name: student, exact: true, level: 1 })).toBeVisible();

  // The access links are on the page, under one name, without opening anything.
  await expect(page.getByRole('heading', { name: 'Access links', exact: true })).toBeVisible();
  await expect(page.getByText('No access link yet.')).toBeVisible();

  // A long Next session note stays two lines until asked for.
  const note = page.locator('#next-session-note');
  const clamped = await note.evaluate((element) => element.getBoundingClientRect().height);
  expect(clamped).toBeLessThan(60);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  expect(await note.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(clamped * 3);
  await page.getByRole('button', { name: 'Show less', exact: true }).click();

  // The decks take their full height and the page scrolls, not a strip inside it.
  const library = page.getByRole('listbox', { name: 'Library' });
  const rows = library.getByRole('option');
  await expect(rows).toHaveCount(8);
  const listHeight = await library.evaluate((element) => element.getBoundingClientRect().height);
  const rowHeight = await rows.first().evaluate((element) => element.getBoundingClientRect().height);
  expect(listHeight).toBeGreaterThanOrEqual(rowHeight * 8 - 2);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();

  // At 1024 the header's buttons wrap instead of covering the name.
  await page.setViewportSize({ width: 1024, height: 768 });
  const title = await page.getByRole('heading', { name: student, exact: true, level: 1 }).boundingBox();
  const newDeck = await page.getByRole('main').getByRole('link', { name: 'New deck', exact: true }).first().boundingBox();
  expect(title && newDeck).toBeTruthy();
  const overlaps = title!.x < newDeck!.x + newDeck!.width && newDeck!.x < title!.x + title!.width
    && title!.y < newDeck!.y + newDeck!.height && newDeck!.y < title!.y + title!.height;
  expect(overlaps).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Edit student is a real form: Enter submits, an empty name is reported on the field.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Edit ${student}`, exact: true })).toBeVisible();
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('');
  await name.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Enter a name.');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.fill(student);

  // Move to trash names what goes with the student.
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: `Move ${student} to trash` });
  await expect(dialog).toContainText('decks, access links and learner work');
  await dialog.getByRole('button', { name: 'Move to trash', exact: true }).click();

  // The place says the student is in Trash, offers Restore, and nothing that would fail.
  await expect(page.getByText(`${student} is in Trash.`)).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'New deck', exact: true })).toHaveCount(0);
  // The sidebar's New deck does not file into the trashed student.
  const sidebarNewDeck = page.getByRole('link', { name: 'New deck', exact: true });
  await expect(sidebarNewDeck).toHaveCount(1);
  expect(await sidebarNewDeck.getAttribute('href')).not.toContain(contextId);
  await expect(page.getByRole('heading', { name: 'Access links', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  // The nav lists neither the student nor their space.
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByRole('link', { name: new RegExp(student) })).toHaveCount(0);

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access links', exact: true })).toBeVisible();
  await expect(page.getByText(`${student} is in Trash.`)).toHaveCount(0);
  await expect(nav.getByRole('link', { name: new RegExp(student) })).toHaveCount(1);
});
