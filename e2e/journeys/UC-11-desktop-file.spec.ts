import { test, expect } from '@playwright/test';
import { writeOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { launchDesktop } from '../desktop';

test.skip(process.env.RUN_DESKTOP_JOURNEY !== '1', 'Requires the built desktop application and a native display.');

test('local file uses the shared editor and preserves presentation position on return', async ({}, testInfo) => {
  const directory = await mkdtemp('/tmp/or-desktop-');
  const path = join(directory, 'presentation.openroom');
  await writeOpenRoomPackage(path, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: '17d71b36-4b7d-4cc4-8c50-143b9e8c2aab', localRevision: 0, outline: {
    version: 1, meta: { title: 'Desktop presentation' }, interactions: [], steps: [
      { id: 'first', kind: 'title', title: 'Opening' },
      { id: 'second', kind: 'steps', title: 'Two points', items: ['First point', 'Second point'], reveal: [['header'], ['cell-0'], ['cell-1']] },
    ],
  } }), directory);
  const app = await launchDesktop(join(directory, 'profile'), path);
  try {
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    const page = await app.firstWindow();
    await expect(page.locator('[data-deck-title]')).toHaveText('Desktop presentation');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('button', { name: 'paper', exact: true }).click();
    await page.getByRole('button', { name: '4:3', exact: true }).click();
    await page.locator('[data-deck-present]').click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    await expect(presenter).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(presenter.getByText(/reveal 2\/3/)).toBeVisible();
    await presenter.getByRole('button', { name: 'Audience screen', exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const audience = app.windows().find((window) => window !== page)!;
    await expect(audience.getByText('First point', { exact: true })).toBeVisible();
    await expect(audience.locator('.slide-surface')).toHaveAttribute('data-slide-theme', 'paper');
    const plate = await audience.locator('.slide-surface').boundingBox();
    expect(plate!.width / plate!.height).toBeCloseTo(4 / 3, 1);
    await expect(audience.getByText('Second point', { exact: true })).toHaveCount(0);
    await audience.keyboard.press('ArrowRight');
    await expect(presenter.getByText(/reveal 3\/3/)).toBeVisible();
    await audience.keyboard.press('ArrowLeft');
    await expect(presenter.getByText(/reveal 2\/3/)).toBeVisible();
    await expect(audience.getByText('Second point', { exact: true })).toHaveCount(0);
    await audience.keyboard.press('ArrowLeft');
    await expect(presenter.getByText(/reveal 1\/3/)).toBeVisible();
    await expect(audience.getByText('First point', { exact: true })).toHaveCount(0);
    await audience.keyboard.press('ArrowRight');
    await audience.keyboard.press('ArrowRight');
    await expect(audience.getByText('Second point', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('desktop-presenter.png') });
    await presenter.getByRole('button', { name: 'Edit deck', exact: true }).click();
    await expect(presenter).toHaveCount(0);
    await expect(page.locator('.slide-canvas__frame [data-part="header"]')).toContainText('Two points');
    await page.getByRole('button', { name: 'Rename deck' }).click();
    await page.getByRole('textbox', { name: 'Deck title' }).fill('Renamed desktop deck');
    await page.getByRole('textbox', { name: 'Deck title' }).press('Enter');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
    await page.reload();
    await expect(page.locator('[data-deck-title]')).toHaveText('Renamed desktop deck');
    await expect(page.locator('.slide-canvas__frame .slide-surface')).toHaveAttribute('data-slide-theme', 'paper');
    await expect(page.locator('.slide-canvas__frame .slide-surface')).toHaveAttribute('data-slide-aspect', '4:3');
    await page.screenshot({ path: testInfo.outputPath('desktop-editor.png') });
  } finally {
    await app.context().tracing.stop({ path: testInfo.outputPath('desktop-trace.zip') }).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
});
