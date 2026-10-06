import { test, expect, type Locator, type Page } from '@playwright/test';
import { joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';

const CSRF = { 'x-openroom-csrf': '1' };
const passage = 'Am Samstag wollte Léa das Museum besuchen, aber es war geschlossen. Deshalb ging sie zum Markt und traf dort eine Freundin. Gemeinsam kauften sie frisches Gemüse.';
const lastToken = 20;

async function dragPhrase(page: Page, surface: Locator) {
  const words = surface.locator('[data-part="body"] [data-token]');
  const start = await words.nth(2).boundingBox();
  if (!start) throw new Error('The reading passage must be visible.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  for (let index = 3; index <= lastToken; index++) {
    const box = (await words.nth(index).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  }
  await page.mouse.up();
}

async function expectPhrase(surface: Locator) {
  await expect.poll(() => surface.evaluate((root, end) => {
    const words = [...root.querySelectorAll<HTMLElement>('[data-part="body"] [data-token]')]
      .filter((word) => Number(word.dataset.token) >= 2 && Number(word.dataset.token) <= end)
      .flatMap((word) => [...word.getClientRects()]);
    const washes = [...root.querySelectorAll('.ink-highlight')].map((wash) => wash.getBoundingClientRect());
    if (!words.length || !washes.length) return false;
    const frame = root.querySelector('.ink-overlay, .learner-ink')!.getBoundingClientRect();
    // Every selected word is painted; each swipe is only one line high.
    return words.every((word) => washes.some((wash) => wash.left <= word.left + 1 && wash.right >= word.right - 1
      && wash.top <= word.top + 1 && wash.bottom >= word.bottom - 1))
      && washes.every((wash) => wash.height <= Math.max(...words.map((word) => word.height)) + frame.height * 0.01 + 2);
  }, lastToken), { message: 'The phrase highlight follows each line of selected words.' }).toBe(true);
}

test.beforeAll(async () => { await waitForWorker(); });
test('phrase marks follow wrapped reading; freehand and reveal keep their place on every surface', async ({ page, browser }, testInfo) => {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content: {
    version: 1, meta: { title: 'Reading together' }, defaults: { identityMode: 'pseudonymous' },
    design: { ...defaultDeckDesign('paper'), aspectRatio: '4:3' }, interactions: [], steps: [
      { id: 'reading', kind: 'statement', layout: 'text', title: 'Ein anderer Plan', body: passage, reveal: [['header'], ['body']] },
      { id: 'compare', kind: 'cards', layout: 'grid', title: 'Compare the reasons', items: [{ label: 'French', text: 'Le musée était fermé.' }, { label: 'German', text: 'Das Museum war geschlossen.' }], reveal: [['header'], ['cell-0'], ['cell-1']] },
    ],
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const { deck } = await created.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await page.locator('[data-deck-present]').click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(presenter.locator('[data-part="body"]')).toHaveText(passage);
  await page.keyboard.press('ArrowLeft');
  await expect(presenter.locator('[data-part="body"]')).toHaveCount(0);
  await expect(presenter.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  const launch = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
  const response = await launch;
  expect(response.status(), await response.text()).toBe(201);
  const session = await response.json();
  await expect(presenter.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
  const mirror = presenter.locator('.stage-mirror');
  await expect.poll(async () => {
    const box = (await mirror.boundingBox())!;
    return box.width / box.height;
  }).toBeCloseTo(4 / 3, 2);
  const stage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await stage.goto(stageUrl(session));
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await joinInBrowser(phone, session.code);
  await phone.getByRole('button', { name: 'Reading', exact: true }).click();
  const phoneSlide = phone.locator('.learner-slide__plate');
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    await expect(surface.getByText('Ein anderer Plan', { exact: true })).toBeVisible();
    await expect(surface.locator('[data-part="body"]')).toHaveCount(0);
  }
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('[data-part="body"]')).toHaveText(passage);
  await presenter.getByRole('tab', { name: 'Draw', exact: true }).click();
  await presenter.getByRole('button', { name: 'Highlight', exact: true }).click();
  await dragPhrase(page, mirror);
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expectPhrase(surface);
  expect(await phoneSlide.locator('.ink-highlight').count()).toBeGreaterThan(1);
  await phone.setViewportSize({ width: 320, height: 700 });
  await expectPhrase(phoneSlide);
  await phone.screenshot({ path: testInfo.outputPath('wrapped-phrase-phone.png'), fullPage: true });
  await phone.getByRole('button', { name: 'Slide', exact: true }).click();
  await expectPhrase(phoneSlide);
  await stage.setViewportSize({ width: 1000, height: 700 });
  await expectPhrase(stage.locator('.stage'));
  // Back hides the passage without deleting its annotation; revealing it remeasures the words.
  await presenter.getByRole('tab', { name: 'Home', exact: true }).click();
  await presenter.getByRole('button', { name: 'Back', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    await expect(surface.locator('[data-part="body"], .ink-highlight')).toHaveCount(0);
  }
  await expect(presenter.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expectPhrase(surface);
  await presenter.getByRole('tab', { name: 'Draw', exact: true }).click();
  await presenter.getByRole('button', { name: 'Underline', exact: true }).click();
  await dragPhrase(page, mirror);
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('[data-mark-kind="underline"] polyline').first()).toBeVisible();
  // Erasing any line removes the phrase once, on all clients.
  await presenter.getByRole('button', { name: 'Underline', exact: true }).click();
  const wash = (await mirror.locator('.ink-highlight').first().boundingBox())!;
  await page.mouse.dblclick(wash.x + wash.width / 2, wash.y + wash.height / 2);
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('.ink-highlight')).toHaveCount(0);
  await presenter.getByRole('button', { name: 'Clear', exact: true }).click();
  await presenter.getByRole('button', { name: 'Pen', exact: true }).click();
  const ink = mirror.locator('.ink-overlay');
  const frame = (await ink.boundingBox())!;
  await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.4, frame.y + frame.height * 0.8, { steps: 10 });
  await page.mouse.move(frame.x + frame.width * 0.6, frame.y + frame.height * 0.85, { steps: 10 });
  await page.mouse.up();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    const pen = surface.locator('[data-mark-kind="pen"]');
    await expect(pen).toHaveCount(1);
    // Measure the centreline, excluding the round cap's stroke width.
    const box = await pen.evaluate((element: SVGPolylineElement) => {
      const bounds = element.getBBox();
      const matrix = element.getScreenCTM()!;
      const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
      const end = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix);
      return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
    });
    const plate = (await surface.locator('.slide-surface').boundingBox())!;
    expect((box.x - plate.x) / plate.width).toBeCloseTo(0.2, 2);
    expect(box.width / plate.width).toBeCloseTo(0.4, 2);
    expect((box.y - plate.y) / plate.height).toBeCloseTo(0.8, 2);
  }
  await page.screenshot({ path: testInfo.outputPath('freehand-host.png') });
  await phone.getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(phoneSlide.locator('[data-mark-kind="pen"]')).toHaveCount(0);
  await phone.getByRole('button', { name: 'Slide', exact: true }).click();
  await expect(phoneSlide.locator('[data-mark-kind="pen"]')).toHaveCount(1);
  await presenter.getByRole('tab', { name: 'Home', exact: true }).click();
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    await expect(surface.getByText('Compare the reasons', { exact: true })).toBeVisible();
    await expect(surface.locator('[data-mark-id]')).toHaveCount(0);
    await expect(surface.locator('[data-part="cell-0"], [data-part="cell-1"]')).toHaveCount(0);
  }
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    await expect(surface.getByText('Le musée était fermé.', { exact: true })).toBeVisible();
    await expect(surface.getByText('Das Museum war geschlossen.', { exact: true })).toHaveCount(0);
  }
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.getByText('Das Museum war geschlossen.', { exact: true })).toBeVisible();
  await stage.screenshot({ path: testInfo.outputPath('revealed-comparison-stage.png') });
  const remote = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await remote.goto(`${new URL(page.url()).origin}/host/#/sessions/${session.sessionCode}/remote?token=${encodeURIComponent(session.hostToken)}`);
  await remote.getByRole('button', { name: '← Back', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) {
    await expect(surface.getByText('Le musée était fermé.', { exact: true })).toBeVisible();
    await expect(surface.locator('[data-part="cell-1"]')).toHaveCount(0);
  }
  await remote.getByRole('button', { name: '← Back', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('[data-part="cell-0"], [data-part="cell-1"]')).toHaveCount(0);
  await remote.getByRole('button', { name: '← Back', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('[data-part="body"]')).toHaveText(passage);
  await remote.getByRole('button', { name: '← Back', exact: true }).click();
  for (const surface of [mirror, stage.locator('.stage'), phoneSlide]) await expect(surface.locator('[data-part="body"]')).toHaveCount(0);
  await expect(remote.getByRole('button', { name: '← Back', exact: true })).toBeDisabled();
  await remote.screenshot({ path: testInfo.outputPath('reveal-remote.png'), fullPage: true });
  await stage.close(); await phone.close(); await remote.close();
});
