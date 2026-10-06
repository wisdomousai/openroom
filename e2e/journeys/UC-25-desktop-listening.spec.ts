import { test, expect } from '@playwright/test';
import { readOpenRoomPackage, writeOpenRoomPackage } from '../../apps/desktop/src/openroom-package';
import { encodeVoiceWav } from '../../packages/schema/src/voice-audio';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchDesktop } from '../desktop';

test.skip(process.env.RUN_DESKTOP_JOURNEY !== '1', 'Requires the built desktop application and a native display.');

for (const format of ['wav', 'mp3', 'm4a'] as const) test(`embed ${format}, reopen it offline, seek and reveal its transcript on the audience screen`, async ({}, testInfo) => {
  const directory = await mkdtemp('/tmp/or-desktop-listening-');
  const path = join(directory, 'listening.openroom');
  const audioPath = join(directory, `appointment.${format}`);
  if (format === 'wav') await writeFile(audioPath, encodeVoiceWav(Float32Array.from({ length: 16_000 * 20 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 16_000) * 0.02)));
  else await copyFile(resolve(`fixtures/listening/tone.${format}`), audioPath);
  await writeOpenRoomPackage(path, JSON.stringify({ format: 'openroom-file', fileVersion: 1, fileId: '8946a4b4-4222-4d5f-99fa-748c0194e0c3', localRevision: 0, outline: {
    version: 1, meta: { title: 'An appointment' }, interactions: [], steps: [
      { id: 'listen', kind: 'media', title: 'Listen for the new time', media: { type: 'audio', url: 'https://local.openroom.invalid/openroom-pending-audio', alt: 'The appointment', listening: { mode: 'room' } } },
      { id: 'next', kind: 'title', title: 'When is the appointment?' },
    ],
  } }), directory);
  const app = await launchDesktop(join(directory, 'profile'), path);
  try {
    await app.context().tracing.start({ screenshots: true, snapshots: true });
    // Only the OS picker is replaced; the real IPC, import, file save and resource protocol run.
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, audioPath);
    const page = await app.firstWindow();
    await expect(page.locator('[data-deck-title]')).toHaveText('An appointment');
    await page.getByRole('button', { name: 'Choose audio file', exact: true }).click();
    await expect(page.getByText('Audio saved in this deck.', { exact: true })).toBeVisible();
    const transcript = 'Der Termin fällt aus. Wir treffen uns am Donnerstag um halb zehn.';
    await page.getByLabel('Transcript', { exact: true }).fill(transcript);
    await page.getByLabel('Transcript', { exact: true }).press('Tab');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
    const saved = await readOpenRoomPackage(path, join(directory, 'reopened'));
    const media = saved.file.outline.steps[0].media!;
    expect(media.listening).toEqual({ mode: 'room', transcript });
    expect(media.resourceId).toBeTruthy();
    expect(saved.file.resources![media.resourceId!].contentType).toBe({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' }[format]);
    // No remote file service is available for the rest of this journey.
    await app.context().route(/^https?:\/\//, (route) => route.abort());
    await page.reload();
    await expect(page.getByLabel('Transcript', { exact: true })).toHaveValue(transcript);
    const preview = page.locator('audio');
    await expect.poll(() => preview.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThanOrEqual(20);
    expect(await preview.evaluate((element: HTMLAudioElement) => element.duration)).toBeLessThan(20.2);
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(preview).toHaveJSProperty('paused', false);
    await page.locator('[data-deck-present]').click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    const controls = presenter.getByRole('region', { name: 'Listening controls', exact: true });
    const player = controls.locator('audio');
    await expect(player).toHaveJSProperty('paused', true);
    await expect.poll(() => page.locator('audio').evaluateAll((items) => items.filter((item) => !(item as HTMLAudioElement).paused).length)).toBe(0);
    await presenter.getByRole('button', { name: 'Audience screen', exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const audience = app.windows().find((window) => window !== page)!;
    await expect(audience.getByText('Listen for the new time', { exact: true })).toBeVisible();
    await expect(audience.locator('audio')).toHaveCount(0);
    await expect(audience.getByText(transcript, { exact: true })).toHaveCount(0);
    await controls.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(player).toHaveJSProperty('paused', false);
    await player.evaluate((element: HTMLAudioElement) => { element.currentTime = 12; });
    await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(12);
    await controls.getByRole('button', { name: '0.75×', exact: true }).click();
    await expect(player).toHaveJSProperty('playbackRate', 0.75);
    await controls.getByRole('button', { name: 'Show transcript', exact: true }).click();
    await expect(audience.getByText(transcript, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('desktop-listening.png') });
    await audience.screenshot({ path: testInfo.outputPath('desktop-listening-audience.png') });
    await controls.getByRole('button', { name: 'Hide transcript', exact: true }).click();
    await expect(audience.getByText(transcript, { exact: true })).toHaveCount(0);
    await presenter.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(controls).toHaveCount(0);
    await expect.poll(() => page.locator('audio').evaluateAll((items) => items.filter((item) => !(item as HTMLAudioElement).paused).length)).toBe(0);
    await expect(audience.getByText('When is the appointment?', { exact: true })).toBeVisible();
  } finally {
    await app.context().tracing.stop({ path: testInfo.outputPath('desktop-trace.zip') }).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
});
