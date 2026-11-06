/**
 * UC-55 — Desktop: save from the menu, close with unsaved changes, damaged files, signed out
 *
 * A tutor keeps one .openroom file per student. File > Save writes the file,
 * closing a window with unsaved changes asks first, a recovery copy is offered
 * when that file opens again, a file that cannot be opened says why, and a
 * signed-out window offers Sign in instead of an error.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readOpenRoomPackage, writeOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { launchDesktop } from '../desktop';

test.skip(process.env.RUN_DESKTOP_JOURNEY !== '1', 'Requires the built Desktop application and a native display.');

const destroyAll = async (app: ElectronApplication) => {
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await app.close();
};

/** Native message boxes answer with `response`; each call's message is kept for the test to read. */
async function answerMessageBoxes(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const store = globalThis as unknown as { messages: string[] };
    store.messages = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.find((arg) => typeof arg === 'object' && arg !== null && 'message' in arg) as { message: string; detail?: string };
      store.messages.push(`${options.message} ${options.detail ?? ''}`.trim());
      return { response: answer, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

const messages = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { messages: string[] }).messages);

/** Runs a File menu item for the window that shows `page`. */
async function fileMenu(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }, name) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/core/index.html#/file'))!;
    const file = Menu.getApplicationMenu()!.items.find((item) => item.label === 'File')!;
    const item = file.submenu!.items.find((candidate) => candidate.label === name)!;
    item.click(undefined, window, window.webContents);
  }, label);
}

async function rename(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Rename deck' }).click();
  await page.getByRole('textbox', { name: 'Deck title' }).fill(title);
  await page.getByRole('textbox', { name: 'Deck title' }).press('Enter');
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'dirty');
}

const FILE_ID = '5b0c8f0e-3c3b-4d2a-9a51-2f5b0d6c7e11';

/** Closes the window as its close button does, so the unsaved-changes prompt runs. */
async function closeWindow(app: ElectronApplication, page: Page): Promise<void> {
  await (await app.browserWindow(page)).evaluate((window) => window.close());
}

/** Opens a file as Finder does and returns its window. */
async function openFile(app: ElectronApplication, file: string): Promise<Page> {
  const opened = app.waitForEvent('window');
  await app.evaluate(({ app: electronApp }, target) => { electronApp.emit('open-file', { preventDefault() {} }, target); }, file);
  return opened;
}

const fileWindows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/core/index.html#/file')).length);

test('save from the File menu, ask before closing unsaved changes, and offer the recovery copy', async ({}, testInfo) => {
  const directory = await mkdtemp('/tmp/openroom-desktop-save-');
  const path = join(directory, 'maya.openroom');
  const profile = join(directory, 'profile');
  await writeOpenRoomPackage(path, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: FILE_ID, localRevision: 0, outline: {
    version: 1, meta: { title: 'Maya, lesson 4' }, interactions: [], steps: [{ id: 'opening', kind: 'title', title: 'Au café' }],
  } }), directory);
  const app = await launchDesktop(profile, path);
  try {
    let page = await app.firstWindow();
    await expect(page.locator('[data-deck-title]')).toHaveText('Maya, lesson 4');
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((item) => item.label === 'File')!.submenu!.items
      .filter((item) => item.type !== 'separator').map((item) => [item.label, item.accelerator ?? null]));
    expect(menu).toEqual(expect.arrayContaining([['Save', 'CmdOrCtrl+S'], ['Save As…', 'Shift+CmdOrCtrl+S'], ['Present', 'Alt+CmdOrCtrl+P']]));

    // File > Save writes the file and the window stops being edited.
    await rename(page, 'Maya, lesson 4 (menu save)');
    if (process.platform === 'darwin') await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(true);
    await fileMenu(app, 'Save');
    await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
    expect((await readOpenRoomPackage(path, join(directory, 'read-1'))).file.outline.meta.title).toBe('Maya, lesson 4 (menu save)');
    if (process.platform === 'darwin') await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited())).toBe(false);

    // File > Present opens the Presenter.
    await fileMenu(app, 'Present');
    await expect(page.getByRole('dialog', { name: 'Presenter', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit deck', exact: true }).click();

    // A second window keeps the app running on every platform while this one closes.
    await fileMenu(app, 'New');
    await expect.poll(() => fileWindows(app)).toBe(2);

    // Close with unsaved changes: Cancel keeps the window, Save writes the file and closes it.
    await rename(page, 'Maya, lesson 4 (saved on close)');
    await answerMessageBoxes(app, 2);
    await closeWindow(app, page);
    await expect.poll(() => messages(app)).toEqual([expect.stringContaining('Do you want to save the changes to maya.openroom?')]);
    expect(await fileWindows(app)).toBe(2);
    await answerMessageBoxes(app, 0);
    await closeWindow(app, page);
    await expect.poll(() => fileWindows(app)).toBe(1);
    expect((await readOpenRoomPackage(path, join(directory, 'read-2'))).file.outline.meta.title).toBe('Maya, lesson 4 (saved on close)');

    // A window that ends without saving (a crash) leaves a recovery copy; opening the file offers it.
    await answerMessageBoxes(app, 0);
    page = await openFile(app, path);
    await expect(page.locator('[data-deck-title]')).toHaveText('Maya, lesson 4 (saved on close)');
    expect(await messages(app)).toEqual([]);
    await rename(page, 'Maya, lesson 4 (crashed)');
    await expect.poll(() => readdir(join(profile, 'recovery'))).toContain(`${FILE_ID}.json`);
    await (await app.browserWindow(page)).evaluate((window) => window.destroy());
    await expect.poll(() => fileWindows(app)).toBe(1);
    const reopened = await openFile(app, path);
    expect(await messages(app)).toEqual([expect.stringContaining('maya.openroom has changes that were not saved to the file.')]);
    await expect(reopened.locator('[data-deck-title]')).toHaveText('Maya, lesson 4 (crashed)');
    const notice = reopened.getByRole('status').filter({ hasText: 'Recovered changes that had not been saved to the file.' });
    await expect(notice).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath('desktop-recovered.png') });
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);

    // Don't Save closes the window and deletes the recovery copy.
    await answerMessageBoxes(app, 1);
    await closeWindow(app, reopened);
    await expect.poll(() => fileWindows(app)).toBe(1);
    expect(await readdir(join(profile, 'recovery'))).not.toContain(`${FILE_ID}.json`);
  } finally {
    await destroyAll(app);
  }
});

test('a damaged file says why it did not open; signed out, the window offers Sign in', async ({}, testInfo) => {
  const directory = await mkdtemp('/tmp/openroom-desktop-signed-out-');
  const path = join(directory, 'lesson.openroom');
  const broken = join(directory, 'broken.openroom');
  await writeFile(broken, 'not a deck');
  await writeOpenRoomPackage(path, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: '0f5d8b9e-1a2b-4c3d-8e9f-a1b2c3d4e5f6', localRevision: 0, outline: {
    version: 1, meta: { title: 'Signed-out lesson' }, interactions: [], steps: [{ id: 'opening', kind: 'title', title: 'Bonjour' }],
  } }), directory);
  const app = await launchDesktop(join(directory, 'profile'), path);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1280, 800); });
    await expect(page.locator('[data-deck-title]')).toHaveText('Signed-out lesson');

    // File > Open… on a damaged file names it and the reason; the open window stays.
    await answerMessageBoxes(app, 0);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, broken);
    await fileMenu(app, 'Open…');
    await expect.poll(() => messages(app)).toEqual(['broken.openroom could not be opened. The file is damaged or is not an OpenRoom deck.']);
    expect(await fileWindows(app)).toBe(1);

    // Signed out with no live server: the bar says so and offers both ways to go live.
    const note = page.getByRole('status').filter({ hasText: 'Live sessions need a sign-in or a live server.' });
    await expect(note).toBeVisible();
    await expect(note.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(note.getByRole('button', { name: 'Live server…', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
    // A local file has no folder to go back to.
    await expect(page.getByRole('link', { name: 'Back' })).toHaveCount(0);
    await note.getByRole('button', { name: 'Live server…', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath('desktop-signed-out-bar.png') });

    // Save to workspace… signed out asks for a sign-in, not an error code.
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Save to workspace…', exact: true }).click();
    const link = page.getByRole('dialog', { name: 'Save to workspace' });
    await expect(link.getByText('Sign in to save this file to a workspace.')).toBeVisible();
    await expect(link.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(link.getByText('Online place')).toHaveCount(0);
    await expect(link.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('desktop-link-signed-out.png') });
    await link.getByRole('button', { name: 'Cancel', exact: true }).click();

    // The Agent pane opens and closes from the bar; closed, the slide canvas keeps its width at the smallest window.
    const agent = page.getByRole('button', { name: 'Agent', exact: true });
    if (await agent.getAttribute('aria-pressed') === 'true') await agent.click();
    await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toHaveCount(0);
    await agent.click();
    await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('desktop-1280-agent-open.png') });
    await page.getByRole('button', { name: 'Close Agent pane', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(980, 680); });
    await expect.poll(async () => (await page.locator('.slide-canvas__frame').boundingBox())?.width ?? 0).toBeGreaterThan(300);
    await page.screenshot({ path: testInfo.outputPath('desktop-980-agent-closed.png') });
    testInfo.annotations.push({ type: 'canvas width at 980 px', description: String((await page.locator('.slide-canvas__frame').boundingBox())?.width) });
  } finally {
    await destroyAll(app);
  }
});
