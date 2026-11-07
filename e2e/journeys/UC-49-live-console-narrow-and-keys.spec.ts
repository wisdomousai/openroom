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
  // Drawing after a Clear ends its undo: Undo takes back the newer mark only.
  await presenter.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(underline).toHaveCount(0);
  await overlay.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(underline).toHaveCount(1);
  await undo.click();
  await expect(underline).toHaveCount(0);
  await expect(undo).toBeDisabled();
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

test('the hidden-results counter fits the console mirror and the wall', async ({ page, browser }, testInfo) => {
  const session = await createSession({
    version: 1, meta: { title: 'Counter' }, defaults: { resultVisibility: 'hidden-until-close' },
    interactions: [{ id: 'ready', type: 'choice', prompt: 'Ready?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }] }],
    steps: [{ id: 'ready', kind: 'interaction', interactionId: 'ready' }],
  });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'ready' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hostUrl(session));
  const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await stage.goto(stageUrl(session));
  for (const [name, surface] of [['mirror', page.locator('.stage-mirror')], ['wall', stage.locator('.stage')]] as const) {
    const label = surface.locator('.pending__label');
    await expect(label).toHaveText('answers so far');
    await expect.poll(() => allInside(surface.locator('.plate__body').first(), surface.locator('.pending__value, .pending__label')), { message: `${name} counter inside the plate body` }).toBe(true);
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('pending-mirror-1440.png') });
  await stage.screenshot({ path: testInfo.outputPath('pending-wall-1920.png') });
  await stage.close();
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

test('a focused button keeps Space, Hide results shows its state, and only the slide on screen sets the question controls', async ({ page, browser }, testInfo) => {
  const session = await createSession({
    version: 1, meta: { title: 'Keys lesson' }, defaults: { resultVisibility: 'live', identityMode: 'pseudonymous' },
    interactions: [{ id: 'ready', type: 'choice', prompt: 'Bist du bereit?', options: [{ id: 'yes', label: 'Ja' }, { id: 'no', label: 'Noch nicht' }] }],
    steps: [
      { id: 'intro', kind: 'statement', layout: 'text', title: 'Anfang', body: 'Wir beginnen.' },
      { id: 'ready', kind: 'interaction', interactionId: 'ready' },
      { id: 'after', kind: 'statement', layout: 'text', title: 'Danach', body: 'Weiter geht es.' },
    ],
  });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  const person = await join(session.code);
  await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'ready' });
  await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'ready' });
  await command(session.sessionCode, person.participantToken, { command: 'answer.submit', interactionId: 'ready', answer: { kind: 'choice', optionIds: ['yes'] } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hostUrl(session));
  const mirror = page.locator('.stage-mirror');
  await expect(mirror.getByText('Bist du bereit?', { exact: true })).toBeVisible();

  // The rail names an untitled question by its prompt.
  const rail = page.getByRole('group', { name: 'Slides', exact: true });
  await expect(rail.getByText('Bist du bereit?', { exact: true })).toBeVisible();

  // Hide results is one toggle with a pressed state, a key and a visible state.
  const toggle = page.getByRole('button', { name: 'Hide results' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'H');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('h');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Results hidden', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('results-hidden.png') });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // A statement after the question carries no question state.
  const next = page.getByRole('button', { name: 'Next', exact: true }).first();
  await next.click();
  await expect(mirror.getByText('Danach', { exact: true })).toBeVisible();
  await expect(page.getByText('Results shown', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/question open|results up/)).toHaveCount(0);
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close answering', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('statement-after-question.png') });

  // The phone remote names the slide on screen and leaves the question alone.
  const remote = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await remote.goto(`${new URL(page.url()).origin}/host/#/sessions/${encodeURIComponent(session.sessionCode)}/remote?token=${encodeURIComponent(session.hostToken)}`);
  await expect(remote.getByText('Danach', { exact: true }).first()).toBeVisible();
  await expect(remote.getByRole('button', { name: /Hide results/ })).toBeDisabled();
  await expect(remote.getByText('Results shown', { exact: true })).toHaveCount(0);
  await remote.screenshot({ path: testInfo.outputPath('remote-statement.png') });
  await remote.close();

  // Space on a focused Back presses Back; an arrow on it still turns the slide.
  const back = page.getByRole('button', { name: 'Back', exact: true }).first();
  await back.click();
  await expect(mirror.getByText('Bist du bereit?', { exact: true })).toBeVisible();
  await expect(back).toBeFocused();
  await page.keyboard.press('Space');
  await expect(mirror.getByText('Anfang', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(mirror.getByText('Bist du bereit?', { exact: true })).toBeVisible();
  await expect(page.getByText('question open', { exact: false })).toBeVisible();

  // The aside switch is a tab list with one selected tab; the notes stay on every tab.
  const tabs = page.getByRole('tablist', { name: 'Session aside', exact: true });
  const sessionTab = tabs.getByRole('tab', { name: 'Session', exact: true });
  await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
  await sessionTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: /^Q&A/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /^Q&A/ })).toBeFocused();
  await expect(mirror.getByText('Bist du bereit?', { exact: true })).toBeVisible();
  await expect(page.getByText('Private notes', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(sessionTab).toHaveAttribute('aria-selected', 'true');

  // Insert offers Term, Statement and Question; From library is gone.
  await page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('button', { name: 'From library' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Term', exact: true }).click();
  const termDialog = page.getByRole('dialog', { name: 'Insert term', exact: true });
  await termDialog.getByLabel('Term', { exact: true }).fill('der Himmel');
  await termDialog.getByLabel('Meaning', { exact: true }).fill('the sky');
  await termDialog.getByRole('button', { name: 'Insert on stage', exact: true }).click();
  await expect(mirror.getByText('der Himmel', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  const statementDialog = page.getByRole('dialog', { name: 'Insert statement', exact: true });
  await statementDialog.getByLabel('Heading', { exact: true }).fill('Pause');
  await statementDialog.getByLabel('Text', { exact: true }).fill('Kurz durchatmen.');
  await statementDialog.getByRole('button', { name: 'Insert on stage', exact: true }).click();
  await expect(mirror.getByText('Pause', { exact: true })).toBeVisible();

  // Change on the inserted statement opens it filled in and replaces it on screen.
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const changeDialog = page.getByRole('dialog', { name: 'Change statement', exact: true });
  await expect(changeDialog.getByLabel('Heading', { exact: true })).toHaveValue('Pause');
  await expect(changeDialog.getByLabel('Text', { exact: true })).toHaveValue('Kurz durchatmen.');
  await changeDialog.getByLabel('Heading', { exact: true }).fill('Kurze Pause');
  await changeDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mirror.getByText('Kurze Pause', { exact: true })).toBeVisible();
  await expect(mirror.getByRole('heading', { name: 'Pause', exact: true })).toHaveCount(0);

  // A question inserted live can carry its correct answer, and the ribbon goes back to Home.
  await page.getByRole('button', { name: 'Question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert question', exact: true });
  await dialog.getByLabel('Question', { exact: true }).fill('Welche Farbe hat der Himmel?');
  await dialog.getByLabel('Option A', { exact: true }).fill('Grün');
  await dialog.getByLabel('Option B', { exact: true }).fill('Blau');
  const markB = dialog.getByRole('button', { name: 'Mark correct, option B', exact: true });
  await markB.click();
  await expect(markB).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('insert-question-correct.png') });
  await dialog.getByRole('button', { name: 'Insert on stage', exact: true }).click();
  await expect(mirror.getByText('Welche Farbe hat der Himmel?', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Call out the correct answer', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('inserted-question.png') });
});

test('the console header keeps End session and the Session menu on a phone', async ({ page }, testInfo) => {
  const session = await createSession({
    version: 1, meta: { title: 'A rather long lesson title for a narrow header' }, defaults: { identityMode: 'pseudonymous' },
    steps: [{ id: 'welcome', kind: 'title', title: 'Hallo' }], interactions: [],
  });
  await command(session.sessionCode, session.hostToken, { command: 'session.start' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(hostUrl(session));
    const header = page.locator('header').first();
    const menuButton = page.getByRole('button', { name: 'Session menu', exact: true });
    await expect(menuButton).toBeVisible();
    const box = (await menuButton.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
    await menuButton.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'End session', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Copy join link', exact: true })).toBeVisible();
    await expect(menu.getByText(/^Keys: /)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`header-menu-${width}.png`) });
    if (width === 320) {
      await menu.getByRole('menuitem', { name: 'Copy join link', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`code=${session.code}`);
    } else {
      await page.keyboard.press('Escape');
    }
  }
});

test('Library from the console menu of a tutoring session opens the student place', async ({ page }, testInfo) => {
  await signIn(page);
  const stamp = Date.now();
  const contextRes = await page.request.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: `Lina ${stamp}`, kind: 'person', context: { language: 'de', level: 'A2' } } });
  expect(contextRes.status()).toBe(201);
  const { id: contextId, spaceId } = (await contextRes.json()).context as { id: string; spaceId: string };
  const content = { version: 1, meta: { title: 'Place lesson' }, defaults: { identityMode: 'identified' }, steps: [{ id: 'welcome', kind: 'title', title: 'Willkommen' }], interactions: [] };
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { title: `Place ${stamp}`, contextId, spaceId, shape: 'tutoring', createSession: true, content } });
  expect(created.status()).toBe(201);
  const sessionId = (await created.json()).session.id as string;
  const launched = await page.request.post(`/api/sessions/${sessionId}/launch`, { headers: CSRF, data: { start: true } });
  expect(launched.status()).toBe(201);
  const { sessionCode, hostToken } = await launched.json();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/host/#/sessions/${encodeURIComponent(sessionCode)}?token=${encodeURIComponent(hostToken)}`);
  // An identified header names the student once.
  const header = page.locator('header').first();
  await expect(header.getByText(`Lina ${stamp}`, { exact: true })).toHaveCount(1);
  await expect(header.getByText('Place lesson', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('identified-header.png') });
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy join link', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Library', exact: true }).click();
  await expect.poll(() => page.url()).toContain(`contextId=${contextId}`);
  await page.screenshot({ path: testInfo.outputPath('library-student-place.png') });
});
