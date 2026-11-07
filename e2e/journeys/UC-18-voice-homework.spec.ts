import { chromium, test, expect } from '@playwright/test';
import { encodeVoiceWav } from '../../packages/schema/src/voice-audio.js';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('voice response upload, private timed feedback, learner deletion and microphone recovery', async ({ page, browser, baseURL }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const { context } = await (await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: 'Französisch sprechen', kind: 'group', experience: 'tutoring' } })).json();
  const { session } = await (await page.request.post('/api/decks', { headers: CSRF, data: { contextId: context.id, spaceId: context.spaceId, createSession: true,
    content: { version: 1, meta: { title: 'Votre voyage' }, steps: [{ id: 'title', kind: 'title', title: 'Votre voyage' }], interactions: [] },
  } })).json();
  expect((await page.request.post(`/api/sessions/${session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  expect((await page.request.put(`/api/sessions/${session.id}/record`, { headers: CSRF, data: { homework: [{ id: 'voice', kind: 'voice', title: 'Votre voyage', prompt: 'Parlez de votre voyage.', guidance: 'Utilisez le passé composé.' }] } })).status()).toBe(200);
  const mint = async (displayName: string) => (await (await page.request.post(`/api/tutoring/contexts/${context.id}/links`, { headers: CSRF, data: { displayName } })).json()).token as string;
  const lea = await mint('Léa');
  const noor = await mint('Noor');
  const learner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await learner.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await learner.goto(`/host/#/learn?token=${lea}`);
  await learner.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(learner.getByRole('alert')).toContainText('microphone is unavailable');
  const samples = Float32Array.from({ length: 64_000 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 16_000) * 0.1);
  await learner.getByLabel('Choose audio file', { exact: true }).setInputFiles({ name: 'my-voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeVoiceWav(samples)) });
  await expect(learner.getByRole('button', { name: 'Send response', exact: true })).toBeEnabled();
  await expect(learner.getByLabel('Preview your response', { exact: true })).toHaveJSProperty('duration', 4);
  let failOnce = true;
  // The retry waits here until the progress bar has been checked.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await learner.route('**/api/learner/voice?*', async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${lea}`);
    expect(route.request().headers().cookie).toBeUndefined();
    if (failOnce) { failOnce = false; await route.abort(); } else { await held; await route.continue(); }
  });
  await learner.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect(learner.getByRole('alert')).toContainText('could not be sent');
  await learner.getByRole('button', { name: 'Send response', exact: true }).click();
  // Sending shows how much has been sent: a determinate bar and a percentage.
  const sending = learner.getByRole('progressbar', { name: 'Sending recording…', exact: true });
  await expect(sending).toHaveJSProperty('max', 100);
  expect(await sending.evaluate((element: HTMLProgressElement) => element.position)).toBeGreaterThanOrEqual(0);
  await expect(learner.getByText(/^\d+\s?%$/)).toBeVisible();
  release();
  await expect(learner.getByText('Response sent', { exact: true })).toBeVisible();
  await learner.getByRole('button', { name: 'Listen · 0:04', exact: true }).click();
  await expect(learner.getByLabel('Voice response', { exact: true })).toHaveJSProperty('duration', 4);
  await page.goto(`/host/#/space/${context.spaceId}?contextId=${context.id}`);
  await page.getByRole('link', { name: 'Review learner work', exact: true }).click();
  await expect(page.getByRole('link', { name: /Léa.*Voice response · 0:04.*Review response/s })).toBeVisible();
  await page.getByRole('link', { name: /Léa.*Review response/s }).click();
  await expect(page.getByRole('heading', { name: 'Léa’s voice response', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Listen · 0:04', exact: true }).click();
  const tutorAudio = page.getByLabel('Voice response', { exact: true });
  await expect(tutorAudio).toHaveJSProperty('duration', 4);
  // Listen plays the recording; it does not stop at a paused player.
  await expect.poll(() => tutorAudio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  // Comments sort by their time in the recording, whatever order they are added in.
  await tutorAudio.evaluate((element: HTMLAudioElement) => { element.pause(); element.currentTime = 3.2; element.dispatchEvent(new Event('timeupdate')); });
  await page.getByRole('button', { name: 'Comment at 0:03', exact: true }).click();
  await expect(page.getByLabel('Feedback at this point', { exact: true })).toBeFocused();
  await page.getByLabel('Feedback at this point', { exact: true }).fill('Bonne intonation.');
  await tutorAudio.evaluate((element: HTMLAudioElement) => { element.pause(); element.currentTime = 1.5; element.dispatchEvent(new Event('timeupdate')); });
  await page.getByRole('button', { name: 'Comment at 0:01', exact: true }).click();
  const comments = page.getByRole('group', { name: /^At \d:\d\d$/ });
  await expect(comments).toHaveCount(2);
  await expect(comments.nth(0)).toHaveAccessibleName('At 0:01');
  await expect(comments.nth(1)).toHaveAccessibleName('At 0:03');
  await expect(comments.nth(0).getByLabel('Feedback at this point', { exact: true })).toBeFocused();
  await comments.nth(0).getByLabel('Feedback at this point', { exact: true }).fill('Faites la liaison ici.');
  await comments.nth(1).getByRole('button', { name: 'Listen at 0:03', exact: true }).click();
  await expect.poll(() => tutorAudio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(3);
  await tutorAudio.evaluate((element: HTMLAudioElement) => element.pause());
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Your tutor’s feedback will appear here.')).toBeVisible();
  await page.getByRole('button', { name: 'Share feedback', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback shared with Léa.' })).toBeVisible();
  await learner.getByRole('tab', { name: 'Lesson', exact: true }).click();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Faites la liaison ici.', { exact: true })).toBeVisible();
  await expect(learner.getByRole('button', { name: /^Listen at / })).toHaveText(['0:01', '0:03']);
  await learner.getByRole('button', { name: 'Listen at 0:01', exact: true }).click();
  await expect(learner.getByRole('tabpanel', { name: 'Feedback' }).getByLabel('Voice response', { exact: true })).toHaveJSProperty('duration', 4);
  await expect(learner.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await learner.screenshot({ path: testInfo.outputPath('voice-feedback-phone.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('voice-tutor-review.png'), fullPage: true });
  await learner.getByRole('tabpanel', { name: 'Feedback' }).getByRole('button', { name: 'Remove recording', exact: true }).click();
  await learner.getByRole('button', { name: 'Move audio to trash', exact: true }).click();
  await expect(learner.getByRole('tabpanel', { name: 'Feedback' }).getByText('This recording has been removed or has expired. Feedback stays available.')).toBeVisible();
  await learner.getByRole('tabpanel', { name: 'Feedback' }).getByRole('button', { name: 'Restore recording', exact: true }).click();
  await expect(learner.getByRole('tabpanel', { name: 'Feedback' }).getByRole('button', { name: 'Listen · 0:04', exact: true })).toBeVisible();
  await learner.getByRole('tabpanel', { name: 'Feedback' }).getByRole('button', { name: 'Remove recording', exact: true }).click();
  await learner.getByRole('button', { name: 'Move audio to trash', exact: true }).click();
  await expect(learner.getByRole('tabpanel', { name: 'Feedback' }).getByRole('button', { name: 'Restore recording', exact: true })).toBeVisible();
  await learner.reload();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Faites la liaison ici.', { exact: true })).toBeVisible();
  await expect(learner.getByRole('button', { name: /Listen/ })).toHaveCount(0);
  await learner.evaluate((token) => { location.hash = `/learn?token=${token}`; }, noor);
  await expect(learner.getByRole('heading', { name: 'Noor', exact: true })).toBeVisible();
  await learner.getByRole('tab', { name: 'Feedback', exact: true }).click();
  await expect(learner.getByText('Your tutor’s feedback will appear here.')).toBeVisible();
  await learner.close();

  // Exercise the browser's real getUserMedia, MediaRecorder and decoder with
  // Chromium's fake capture device. An AudioContext oscillator is not used: its
  // clock only runs while the machine's audio output renders, so on a host
  // without a working output device it records nothing.
  // Physical device permissions and Safari codecs remain separate release checks.
  const fakeMicrophone = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mic = await (await fakeMicrophone.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await mic.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      (window as unknown as { microphoneTrack: MediaStreamTrack }).microphoneTrack = stream.getAudioTracks()[0]!;
      return stream;
    };
  });
  await mic.goto(`/host/#/learn?token=${noor}`);
  // The served Permissions-Policy must let this page use its own microphone;
  // the synthetic getUserMedia above would otherwise hide a blocking header.
  expect(await mic.evaluate(() => (document as Document & { featurePolicy: { allowsFeature(feature: string): boolean } }).featurePolicy.allowsFeature('microphone'))).toBe(true);
  // By keyboard, focus follows each step: Record to Stop, Stop to Send.
  await mic.getByRole('button', { name: 'Record response', exact: true }).focus();
  await mic.keyboard.press('Enter');
  await expect(mic.getByRole('button', { name: 'Stop recording', exact: true })).toBeFocused();
  await expect(mic.getByRole('timer')).not.toHaveText('0:00 / 5:00');
  await mic.keyboard.press('Enter');
  await expect(mic.getByRole('button', { name: 'Send response', exact: true })).toBeFocused();
  await expect(mic.getByText(/^Recording stopped at/)).toHaveCount(0);
  await mic.getByRole('button', { name: 'Record again', exact: true }).click();
  await expect(mic.getByRole('timer')).not.toHaveText('0:00 / 5:00');
  await mic.getByRole('tab', { name: 'Practice', exact: true }).click();
  await expect.poll(() => mic.evaluate(() => (window as unknown as { microphoneTrack: MediaStreamTrack }).microphoneTrack.readyState)).toBe('ended');
  await mic.getByRole('tab', { name: 'Lesson', exact: true }).click();
  await expect(mic.getByRole('status').filter({ hasText: /^Recording stopped at \d:\d\d because you left the Lesson tab\. Listen to it, then send it or record again\.$/ })).toBeVisible();
  await expect(mic.getByRole('button', { name: 'Send response', exact: true })).toBeEnabled();
  await mic.screenshot({ path: testInfo.outputPath('voice-stopped-on-tab-change-phone.png'), fullPage: true });
  await mic.getByRole('button', { name: 'Send response', exact: true }).focus();
  await mic.keyboard.press('Enter');
  await expect(mic.getByText('Response sent', { exact: true })).toBeFocused();
  await expect(mic.getByText(/^Recording stopped at/)).toHaveCount(0);
  await fakeMicrophone.close();
});
