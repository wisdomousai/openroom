import { test, expect } from '@playwright/test';
import { waitForWorker, joinInBrowser, command } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });

test('theme, aspect ratio and master background survive save and live presentation', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const content = { version: 1, meta: { title: 'Saved slide design' }, steps: [
    { id: 'title', kind: 'title', title: 'A shared decision', body: 'Explain your reasons. Listen to another perspective.' },
    { id: 'ask', kind: 'interaction', interactionId: 'choice' },
  ], interactions: [{ id: 'choice', type: 'choice', prompt: 'Ready?', options: [{ id: 'yes', label: 'Yes', correct: true }, { id: 'no', label: 'Not yet' }] }] };
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content } });
  expect(created.status()).toBe(201);
  const deckId = (await created.json()).deck.id;
  await page.goto(`/host/#/decks/${deckId}/edit`);
  await page.getByRole('tab', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'business', exact: true }).click();
  await page.getByRole('button', { name: '16:10', exact: true }).click();
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Team workshop');
  await page.getByRole('textbox', { name: 'Footer', exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Gradient', exact: true }).click();
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  await expect(page.locator('.slide-canvas__frame .slide-surface')).toHaveAttribute('data-slide-theme', 'business');
  const editor = await page.locator('.slide-canvas__frame').boundingBox();
  expect(editor!.width / editor!.height).toBeCloseTo(1.6, 1);
  await page.screenshot({ path: testInfo.outputPath('designed-editor.png') });
  await page.reload();
  await expect(page.locator('.slide-canvas__frame .slide-surface')).toHaveAttribute('data-slide-aspect', '16:10');
  await expect(page.locator('.slide-canvas__frame')).toContainText('Team workshop');
  await page.locator('[data-deck-present]').click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter.locator('.slide-surface')).toHaveAttribute('data-slide-theme', 'business');
  await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(presenter.getByRole('button', { name: 'End session' })).toBeVisible();
  const live = presenter.locator('.stage-mirror .slide-surface');
  await expect(live).toHaveAttribute('data-slide-theme', 'business');
  await expect(live).toContainText('Team workshop');
  const liveBox = await live.boundingBox();
  expect(liveBox!.width / liveBox!.height).toBeCloseTo(1.6, 1);
  await page.screenshot({ path: testInfo.outputPath('designed-live.png') });
  await presenter.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(presenter.locator('.stage-mirror .prompt')).toHaveText('Ready?');
  await expect(live).toHaveAttribute('data-slide-theme', 'business');
  await expect(live).toContainText('Team workshop');
  await page.screenshot({ path: testInfo.outputPath('designed-question.png') });
  const saved = await (await page.request.get(`/api/decks/${deckId}`)).json();
  expect(saved.content.design.theme.family).toBe('business');
  expect(saved.content.design.masters[0].background.kind).toBe('gradient');
  expect(saved.content.interactions).toEqual(content.interactions);
});


const LONG_CAPTION = 'The station opened in 1900 and still serves trains to the south of the country every day. '.repeat(4).trim();

test('phone reading view keeps complete text and can return to the authored slide', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { createSession: true, content: {
    version: 1, meta: { title: 'Phone reading' }, steps: [{ id: 'rules', kind: 'steps', title: 'Three useful phrases', items: [
      'Je voudrais réserver une table pour deux personnes.', 'Könnten Sie das bitte noch einmal erklären?', 'Listen to the complete phrase before you reply.',
    ] }, { id: 'photo', kind: 'media', layout: 'media', title: 'The old station', media: {
      type: 'image', url: 'https://example.org/station.svg', alt: 'The station', caption: LONG_CAPTION,
    } }], interactions: [],
  } } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).session.id;
  const launched = await page.request.post(`/api/sessions/${id}/launch`, { headers: CSRF, data: { start: true } });
  expect(launched.status()).toBe(201);
  const { code, sessionCode, hostToken } = await launched.json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const phone = await context.newPage();
  await joinInBrowser(phone, code);
  // A steps slide is a dense list kind, so a phone below 640 px opens it in
  // Reading until the learner picks a view (decision LD8).
  await expect(phone.getByRole('button', { name: 'Reading', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.getByRole('button', { name: 'Slide', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const phrases = phone.locator('.outline-step__sequence li p');
  await expect(phrases).toHaveCount(3);
  const sizes = await phrases.evaluateAll((nodes) => nodes.map((node) => ({
    font: parseFloat(getComputedStyle(node).fontSize), height: node.clientHeight, content: node.scrollHeight,
  })));
  expect(sizes.every((item) => item.font >= 16 && item.content <= item.height + 2)).toBe(true);
  await phone.screenshot({ path: testInfo.outputPath('phone-reading.png'), fullPage: true });
  await phone.getByRole('button', { name: 'Slide', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Slide', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const slide = await phone.locator('.slide-surface').boundingBox();
  expect(slide!.width / slide!.height).toBeCloseTo(16 / 9, 1);
  await phone.screenshot({ path: testInfo.outputPath('phone-slide.png') });
  // The picked view is remembered for this session after a reload.
  await phone.reload();
  await expect(phone.getByRole('button', { name: 'Slide', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The media layout clamps a long caption to three lines on the slide; Reading shows all of it.
  await command(sessionCode, hostToken, { command: 'outline.goto', stepId: 'photo' });
  const caption = phone.locator('.outline-step__caption');
  await expect(caption).toHaveText(LONG_CAPTION);
  await phone.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Reading', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const shown = await caption.evaluate((node) => ({
    clamp: getComputedStyle(node).webkitLineClamp, height: node.clientHeight, content: node.scrollHeight,
    lines: node.clientHeight / parseFloat(getComputedStyle(node).lineHeight),
  }));
  expect(shown.clamp).toBe('none');
  expect(shown.content).toBeLessThanOrEqual(shown.height + 2);
  expect(shown.lines).toBeGreaterThan(3);
  await phone.screenshot({ path: testInfo.outputPath('phone-reading-caption.png'), fullPage: true });
  await context.close();
  await command(sessionCode, hostToken, { command: 'outline.goto', stepId: 'rules' });

  // A new desktop participant still has the rejoin notice. It must not take
  // the slide's available height or force the person to dismiss it first.
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await joinInBrowser(desktop, code);
  await expect(desktop.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible();
  await expect(desktop.getByRole('heading', { name: 'Three useful phrases', exact: true })).toBeVisible();
  const desktopSlide = await desktop.locator('.slide-surface').boundingBox();
  expect(desktopSlide!.height).toBeGreaterThan(200);
  expect(desktopSlide!.width / desktopSlide!.height).toBeCloseTo(16 / 9, 1);
  await desktop.screenshot({ path: testInfo.outputPath('desktop-slide-with-notice.png') });
  await desktop.close();
});
