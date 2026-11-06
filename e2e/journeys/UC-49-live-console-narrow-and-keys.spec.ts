/**
 * UC-49 — Live console at portrait widths, from the keyboard, and long charts on the Stage.
 * Contract: docs/journeys/UC-49-live-console-narrow-and-keys.md
 *
 * The console keeps its slide on a portrait tablet. Escape first cancels an
 * armed lookup before it leaves the session. The slide words, the word menu,
 * the chart menu and the slide rail answer the keyboard. Undo brings back the
 * marks Clear removed. On the Stage, a match with long pairs and a pie or
 * radial with long labels keep every row and their plot inside the plate. A
 * long Next session note takes two lines until Show all, and a notes screen
 * that cannot open says so and offers Back to library.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

import { command, createSession, hostUrl, join, stageUrl, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };

test.beforeAll(async () => {
  await waitForWorker();
});

async function signIn(page: Page): Promise<void> {
  const res = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  expect(res.status()).toBe(200);
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
}

async function slideBox(mirror: Locator) {
  const box = await mirror.locator('.slide-surface').first().boundingBox();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Every element of `inner` lies inside `outer`, give or take a pixel of rounding. */
async function allInside(outer: Locator, inner: Locator): Promise<boolean> {
  const frame = await outer.boundingBox();
  if (!frame) return false;
  const boxes = await inner.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  return boxes.length > 0 && boxes.every((box) => box.left >= frame.x - 1 && box.top >= frame.y - 1
    && box.right <= frame.x + frame.width + 1 && box.bottom <= frame.y + frame.height + 1);
}

test('the console keeps its slide on a portrait tablet and every live control answers the keyboard', async ({ page }, testInfo) => {
  await signIn(page);
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content: {
    version: 1, meta: { title: 'Keyboard lesson' }, defaults: { identityMode: 'pseudonymous' }, steps: [
      { id: 'reading', kind: 'statement', layout: 'text', title: 'Ein Plan', body: 'Am Samstag wollte Léa das Museum besuchen.' },
      { id: 'check', kind: 'interaction', interactionId: 'ready' },
    ],
    interactions: [{ id: 'ready', type: 'choice', prompt: 'Ready?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }] }],
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const { deck } = await created.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await page.locator('[data-deck-present]').click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  const launch = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
  expect((await launch).status()).toBe(201);
  await expect(presenter.getByRole('button', { name: 'End session', exact: true }).first()).toBeVisible();
  const mirror = presenter.locator('.stage-mirror');
  await expect(mirror.getByText('Ein Plan', { exact: true })).toBeVisible();

  // A portrait tablet keeps a readable slide: the single-child Stage grid no
  // longer collapses its only row to nothing.
  for (const viewport of [{ width: 768, height: 1024 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await slideBox(mirror)).height, { message: `slide height at ${viewport.width}px` }).toBeGreaterThan(150);
    expect((await slideBox(mirror)).width).toBeGreaterThan(300);
    await page.screenshot({ path: testInfo.outputPath(`console-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Escape cancels an armed lookup first and keeps the session console open.
  await presenter.getByRole('tab', { name: 'Draw', exact: true }).click();
  await presenter.getByRole('button', { name: 'Look up a word', exact: true }).click();
  await expect(presenter.getByRole('button', { name: 'Picking word…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presenter.getByRole('button', { name: 'Look up a word', exact: true })).toBeVisible();
  await expect(presenter.getByRole('button', { name: 'End session', exact: true }).first()).toBeVisible();

  // A mouse click on the slide does not take the clicker keys from the page.
  const overlay = mirror.locator('.ink-overlay');
  await overlay.click({ position: { x: 20, y: 20 } });
  await expect(overlay).not.toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(mirror.getByText('Ready?', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(mirror.getByText('Ein Plan', { exact: true })).toBeVisible();

  // The slide is one tab stop; arrows walk the words and the live region names each.
  await overlay.focus();
  await page.keyboard.press('ArrowRight');
  await expect(overlay.locator('[aria-live]')).toHaveText('Ein');
  await page.keyboard.press('End');
  await expect(overlay.locator('[aria-live]')).toHaveText(/besuchen/);
  await expect(mirror.getByText('Ein Plan', { exact: true })).toBeVisible();

  // Shift+F10 opens the same word menu as a right-click on that word.
  await page.keyboard.press('Shift+F10');
  const wordMenu = page.getByRole('menu');
  await expect(wordMenu.getByRole('menuitem', { name: 'Look up', exact: true })).toBeVisible();
  await expect(wordMenu.getByText(/besuchen/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wordMenu).toHaveCount(0);
  await expect(presenter.getByRole('button', { name: 'End session', exact: true }).first()).toBeVisible();

  // With a shape tool, Enter marks the keyboard word.
  await presenter.getByRole('button', { name: 'Underline', exact: true }).click();
  await overlay.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  const underline = mirror.locator('[data-mark-kind="underline"]');
  await expect(underline).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(underline).toHaveCount(2);

  // Clear removes every mark; Undo brings them back, then takes back the last one.
  await presenter.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(underline).toHaveCount(0);
  const undo = presenter.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(underline).toHaveCount(2);
  await undo.click();
  await expect(underline).toHaveCount(1);
  await presenter.getByRole('button', { name: 'Underline', exact: true }).click();

  // The slide rail is one tab stop; arrows move focus, Enter goes to the slide.
  const rail = presenter.getByRole('group', { name: 'Slides', exact: true });
  await expect(rail.locator('button[tabindex="0"]')).toHaveCount(1);
  await rail.locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(mirror.getByText('Ready?', { exact: true })).toBeVisible();
  await expect(rail.locator('button[tabindex="0"]')).toHaveCount(1);
  await expect(rail.locator('button[aria-current="step"]')).toHaveAttribute('tabindex', '0');

  // The chart menu takes focus on the checked display, arrows move, Escape returns focus.
  await presenter.getByRole('tab', { name: 'Home', exact: true }).click();
  const opener = presenter.getByRole('button', { name: /^Drawn as / });
  await opener.click();
  const chartMenu = page.getByRole('menu', { name: 'Chart type', exact: true });
  await expect(chartMenu).toBeVisible();
  const checked = chartMenu.locator('[role="menuitemradio"][aria-checked="true"]');
  await expect(checked).toBeFocused();
  const first = await checked.textContent();
  await page.keyboard.press('ArrowDown');
  await expect(checked).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toMatch(/^menuitem/);
  expect(await page.evaluate(() => document.activeElement?.textContent)).not.toBe(first);
  await page.screenshot({ path: testInfo.outputPath('chart-menu-keys.png') });
  await page.keyboard.press('Escape');
  await expect(chartMenu).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(presenter.getByRole('button', { name: 'End session', exact: true }).first()).toBeVisible();

  // With nothing armed or open, Escape leaves the console for the deck.
  await page.keyboard.press('Escape');
  await expect(presenter).toHaveCount(0);
});

test('long match pairs and long pie or radial labels stay inside the Stage plate', async ({ browser }, testInfo) => {
  const long = (index: number) => `A rather long answer label number ${index + 1}`;
  const left = Array.from({ length: 6 }, (_, index) => ({ id: `l${index}`, label: `Le mot assez long numéro ${index + 1}` }));
  const right = Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, label: `The fairly long meaning ${index + 1}` }));
  const options = Array.from({ length: 8 }, (_, index) => ({ id: `o${index}`, label: long(index) }));
  const session = await createSession({
    version: 1, meta: { title: 'Long charts' }, defaults: { resultVisibility: 'live' },
    interactions: [
      { id: 'pairs', type: 'match', display: 'pairs', prompt: 'Match each word to its meaning.', left, right,
        correct: Object.fromEntries(left.map((item, index) => [item.id, right[index]!.id])) },
      { id: 'pie', type: 'choice', display: 'pie', prompt: 'Which one?', options },
      { id: 'radial', type: 'choice', display: 'radial', prompt: 'Which one again?', options },
    ],
    steps: [
      { id: 'pairs', kind: 'interaction', interactionId: 'pairs' },
      { id: 'pie', kind: 'interaction', interactionId: 'pie' },
      { id: 'radial', kind: 'interaction', interactionId: 'radial' },
    ],
  });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  const people = await Promise.all(Array.from({ length: 4 }, () => join(session.code)));
  for (const id of ['pairs', 'pie', 'radial']) {
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: id });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: id });
    for (const [n, person] of people.entries()) {
      const answer = id === 'pairs'
        ? { kind: 'match', pairs: Object.fromEntries(left.map((item, index) => [item.id, right[(index + n) % 6]!.id])) }
        : { kind: 'choice', optionIds: [options[(n * 3) % 8]!.id] };
      await command(session.sessionCode, person.participantToken, { command: 'answer.submit', interactionId: id, answer });
    }
  }

  const stage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await stage.goto(stageUrl(session));
  const plate = stage.locator('.plate').first();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await stage.setViewportSize(viewport);
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'pairs' });
    await expect(stage.getByText('Match each word to its meaning.', { exact: true })).toBeVisible();
    const rows = stage.locator('.or-pairs-chart__row');
    await expect(rows).toHaveCount(6);
    await expect.poll(() => allInside(plate, rows), { message: `pairs rows inside the plate at ${viewport.width}px` }).toBe(true);
    await stage.screenshot({ path: testInfo.outputPath(`pairs-${viewport.width}.png`) });

    for (const [id, prompt] of [['pie', 'Which one?'], ['radial', 'Which one again?']] as const) {
      await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: id });
      await expect(stage.getByText(prompt, { exact: true })).toBeVisible();
      await expect(stage.locator(`[data-or-chart="${id}"]`)).toBeVisible();
      const chart = stage.locator('.or-polar-chart--side');
      await expect(chart).toBeVisible();
      const plot = chart.locator('svg').first();
      const legend = chart.locator('.or-chart-legend--columns');
      await expect.poll(() => allInside(plate, chart.locator('svg, .or-chart-legend--columns li')), { message: `${id} inside the plate at ${viewport.width}px` }).toBe(true);
      const plotBox = (await plot.boundingBox())!;
      const legendBox = (await legend.boundingBox())!;
      // The legend sits beside the plot, and the plot keeps a usable size.
      expect(legendBox.x).toBeGreaterThanOrEqual(plotBox.x + plotBox.width - 1);
      expect(plotBox.height).toBeGreaterThan(viewport.height * 0.25);
      await stage.screenshot({ path: testInfo.outputPath(`${id}-${viewport.width}.png`) });
    }
  }
  await stage.close();
});

test('a long Next session note takes two lines above the console until Show all', async ({ page }, testInfo) => {
  await signIn(page);
  const stamp = Date.now();
  const contextRes = await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: `Noor ${stamp}`, kind: 'person', context: { language: 'de', level: 'A2' } } });
  expect(contextRes.status()).toBe(201);
  const { id: contextId, spaceId } = (await contextRes.json()).context as { id: string; spaceId: string };
  const content = { version: 1, meta: { title: 'Pickup lesson' }, defaults: { identityMode: 'identified' }, steps: [{ id: 'welcome', kind: 'title', title: 'Willkommen' }], interactions: [] };
  const first = await page.request.post('/api/decks', { headers: CSRF, data: { title: `First ${stamp}`, contextId, spaceId, shape: 'tutoring', createSession: true, content } });
  expect(first.status()).toBe(201);
  const firstSession = (await first.json()).session.id as string;
  const launched = await page.request.post(`/api/sessions/${firstSession}/launch`, { headers: CSRF, data: { start: true } });
  expect(launched.status()).toBe(201);
  const { sessionCode, hostToken } = await launched.json();
  await command(sessionCode, hostToken, { command: 'session.end' });
  const note = 'Start with the dative after mit and bei. '.repeat(12).trim();
  const record = await page.request.put(`/api/sessions/${firstSession}/record`, { headers: CSRF, data: { outcomes: [], notes: '', homework: [], artifacts: [], nextNote: note } });
  expect(record.status(), await record.text()).toBe(200);

  const second = await page.request.post('/api/decks', { headers: CSRF, data: { title: `Second ${stamp}`, contextId, spaceId, shape: 'tutoring', content } });
  expect(second.status()).toBe(201);
  const { deck } = await second.json();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await page.locator('[data-deck-present]').click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
  const banner = presenter.getByText(/^Next session · Start with the dative/);
  await expect(banner).toBeVisible();
  const lineHeight = await banner.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 2 + 2);
  const showAll = presenter.getByRole('button', { name: 'Show all', exact: true });
  await expect(showAll).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: testInfo.outputPath('pickup-clamped.png') });
  await showAll.click();
  await expect(presenter.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect((await banner.boundingBox())!.height).toBeGreaterThan(lineHeight * 2 + 2);
  await expect(presenter.locator('.stage-mirror')).toBeVisible();
  await presenter.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(banner).toHaveCount(0);
});

test('when the notes cannot open after a session, the console says so and offers a way back', async ({ page }, testInfo) => {
  const session = await createSession({ version: 1, meta: { title: 'Short lesson' }, steps: [{ id: 'welcome', kind: 'title', title: 'Hello' }], interactions: [] });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  // The session's context cannot be read, before and after the end.
  await page.route('**/api/sessions/*/context', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto(hostUrl(session));
  await page.getByRole('button', { name: 'End session', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^End/ }).click();
  await expect(page.getByText('Notes could not open. Your private notes are kept on this device.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to library', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notes-retry.png') });
});
