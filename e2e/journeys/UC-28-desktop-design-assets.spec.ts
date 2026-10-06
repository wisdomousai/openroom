import { test, expect, type ElectronApplication, type Locator } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readOpenRoomPackage, writeOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';
import { designImage } from '../fixtures/design-images';
import { launchDesktop } from '../desktop';

test.skip(process.env.RUN_DESKTOP_JOURNEY !== '1', 'Requires the built Desktop application and a native display.');
const loaded = async (image: Locator) => { await expect(image).toBeVisible(); await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0); };
const close = async (app: ElectronApplication) => { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close(); };

test('import design images, save, reopen independently offline and present them', async ({ page: fixture }, testInfo) => {
  const directory = await mkdtemp('/tmp/openroom-desktop-brand-');
  const filePath = join(directory, 'classroom.openroom');
  const backgroundPath = join(directory, 'background.png');
  const logoPath = join(directory, 'logo.png');
  await writeFile(backgroundPath, await designImage(fixture));
  await writeFile(logoPath, await designImage(fixture, true));
  await writeOpenRoomPackage(filePath, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: '77aff277-6f82-4bcb-b2ae-d00b1b2e4215', localRevision: 0, outline: {
    version: 1, meta: { title: 'Portable classroom design' }, design: defaultDeckDesign('business'), interactions: [], steps: [
      { id: 'opening', kind: 'title', title: 'Compare the evidence', body: 'Explain your reasoning. Listen for another perspective.' },
      { id: 'closing', kind: 'title', title: 'What changed your mind?' },
    ],
  } }), directory);
  const launch = (profile: string) => launchDesktop(join(directory, profile), filePath);
  let app = await launch('author-profile');
  try {
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    let page = await app.firstWindow();
    await expect(page.locator('[data-deck-title]')).toHaveText('Portable classroom design');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('button', { name: '4:3', exact: true }).click();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, logoPath);
    await page.getByLabel('Logo description', { exact: true }).fill('OpenRoom School');
    await page.getByRole('button', { name: 'Choose logo image', exact: true }).click();
    await loaded(page.locator('.slide-canvas__frame .slide-surface__logo'));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, backgroundPath);
    await page.getByRole('button', { name: 'Choose background image', exact: true }).click();
    await loaded(page.locator('.slide-canvas__frame .slide-surface__background img'));
    await page.getByLabel('x focal point', { exact: true }).press('End');
    await page.getByRole('list', { name: 'Slides' }).getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('button', { name: 'Customize this background', exact: true }).click();
    const override = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This slide', exact: true }) });
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, logoPath);
    await override.getByRole('button', { name: 'Choose background image', exact: true }).click();
    await loaded(page.locator('.slide-canvas__frame .slide-surface__background img'));
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
    const reopened = await readOpenRoomPackage(filePath, join(directory, 'independent-read'));
    expect(Object.keys(reopened.file.resources!)).toHaveLength(3);
    expect(reopened.file.outline.design?.masters[0]?.background).toMatchObject({ resourceId: expect.any(String), focal: { x: 100, y: 50 } });
    expect(reopened.file.outline.design?.masters[0]?.logo).toMatchObject({ resourceId: expect.any(String), alt: 'OpenRoom School' });
    expect(reopened.file.outline.steps[1]?.design?.background).toMatchObject({ resourceId: expect.any(String) });
    await app.context().tracing.stop({ path: testInfo.outputPath('desktop-import-trace.zip') });
    await close(app);
    app = await launch('offline-profile');
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    await app.context().route(/^https?:\/\//, (route) => route.abort());
    page = await app.firstWindow();
    await page.reload();
    await loaded(page.locator('.slide-canvas__frame .slide-surface__logo'));
    await loaded(page.locator('.slide-canvas__frame .slide-surface__background img'));
    await page.locator('[data-deck-present]').click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    const frame = await presenter.locator('.stage-mirror').boundingBox();
    const slide = await presenter.locator('.slide-surface').boundingBox();
    expect(frame!.width / frame!.height).toBeCloseTo(4 / 3, 2);
    expect(slide!.width).toBeCloseTo(frame!.width, 0);
    expect(slide!.height).toBeCloseTo(frame!.height, 0);
    await presenter.getByRole('button', { name: 'Audience screen', exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const audience = app.windows().find((window) => window !== page)!;
    await loaded(audience.locator('.slide-surface__logo'));
    await loaded(audience.locator('.slide-surface__background img'));
    await expect(audience.locator('.slide-surface__background img')).toHaveCSS('object-position', '100% 50%');
    const screen = await audience.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const audienceSlide = await audience.locator('.slide-surface').boundingBox();
    expect(audienceSlide!.height).toBeCloseTo(Math.min(screen.height, screen.width * 3 / 4), 0);
    await audience.locator('[data-part="body"]').hover();
    await expect(audience.locator('[data-part="body"]')).toHaveCSS('outline-style', 'none');
    await audience.screenshot({ path: testInfo.outputPath('offline-branded-audience.png') });
    await presenter.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(audience.getByText('What changed your mind?', { exact: true })).toBeVisible();
    await expect.poll(() => audience.locator('.slide-surface__background img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
    await page.screenshot({ path: testInfo.outputPath('offline-override-presenter.png') });
  } finally {
    await app.context().tracing.stop({ path: testInfo.outputPath('desktop-trace.zip') }).catch(() => {});
    await close(app);
  }
});
