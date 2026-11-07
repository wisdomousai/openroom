/**
 * UC-61 — Which workspace pages fit a phone, and what the Library does instead.
 *
 * Add student, Space settings, Sample lessons, a session's Notes and Review
 * learner work fit a 390 px window with no sideways scroll, as Settings does.
 * The Library keeps its 980 px minimum and says so in one line below it; from
 * 980 px up its tree, list and inspector stay side by side. A student's own
 * space opens as that student's view, with a quiet Notes group: titles only,
 * a repeated title told apart by a silent ordinal.
 *
 * The deck editor keeps rail, canvas and task pane side by side at 1280 px.
 * At 900 px the pane starts closed and Slide pane opens it over the canvas
 * while the rail still answers. At 600 px the editor says to open the deck on
 * a larger screen, and Present and Start session still work.
 */
import { test, expect, type Page } from '@playwright/test';

import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
const NOTICE = 'This page is made for windows at least 980 px wide. Widen the window to see all of it.';

test.beforeAll(async () => { await waitForWorker(); });

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  return page.request;
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${label} scrolls sideways`).toBeLessThanOrEqual(client + 1);
}

test('form and Notes pages fit a phone; the Library keeps three columns from 980 px', async ({ page }, testInfo) => {
  const api = await signIn(page);
  const stamp = Date.now();
  const studentName = `Noor ${stamp}`;
  const title = `Au café ${stamp}`;
  const created = await api.post('/api/tutoring/students', { headers: CSRF, data: { displayName: studentName, kind: 'person', experience: 'tutoring' } });
  expect(created.status()).toBe(201);
  const { student } = await created.json() as { student: { id: string; spaceId: string } };
  // Two lessons of one deck title, each with saved Notes.
  const sessionIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const deckRes = await api.post('/api/decks', { headers: CSRF, data: {
      spaceId: student.spaceId, studentId: student.id, createSession: true,
      content: { version: 1, meta: { title }, steps: [{ id: 'one', kind: 'title', title }], interactions: [] },
    } });
    expect(deckRes.status()).toBe(201);
    const { session } = await deckRes.json() as { session: { id: string } };
    const record = await api.put(`/api/sessions/${session.id}/record`, { headers: CSRF, data: { outcomes: [], notes: '', homework: [], artifacts: [], nextNote: '' } });
    expect(record.status()).toBe(200);
    sessionIds.push(session.id);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const pages: [string, string][] = [
    ['Add student', '/host/#/tutor/students/new?experience=tutoring'],
    ['Space settings', `/host/#/space/${student.spaceId}/edit`],
    ['Sample lessons', `/host/#/space/${student.spaceId}/samples?studentId=${student.id}`],
    ['Notes', `/host/#/sessions/${sessionIds[0]}/record`],
    ['Review learner work', `/host/#/tutor/students/${student.id}/work`],
  ];
  for (const [label, url] of pages) {
    await page.goto(url);
    await expect(page.locator('main h1').first(), label).toBeVisible();
    await expect(page.getByText(NOTICE)).toHaveCount(0);
    await expectNoSidewaysScroll(page, label);
    await page.screenshot({ path: testInfo.outputPath(`390-${label.toLowerCase().replace(/ /g, '-')}.png`) });
  }

  // The Library keeps its desktop width and says so in one line.
  await page.goto(`/host/#/space/${student.spaceId}`);
  await expect(page.getByText(NOTICE)).toBeVisible();
  await expect(page.getByText(NOTICE)).toBeInViewport();

  // A student's own space opens as the student's view, with their Notes.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page).toHaveURL(new RegExp(`studentId=${student.id}`));
  await expect(page.getByRole('heading', { name: studentName, level: 1, exact: true })).toBeVisible();
  await expect(page.getByText(NOTICE)).toBeHidden();
  const notes = page.getByRole('region', { name: 'Notes', exact: true });
  await expect(notes.getByRole('link')).toHaveText([title, `${title} · 2`]);

  // From 980 px the tree, list and inspector sit side by side.
  const library = page.getByRole('listbox', { name: 'Library' });
  await library.getByRole('option').first().click();
  const inspector = page.getByRole('complementary', { name: `${title} details` });
  await expect(inspector).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Folder tree' });
  const [railBox, listBox, panelBox] = await Promise.all([rail.boundingBox(), library.boundingBox(), inspector.boundingBox()]);
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(listBox!.x + 1);
  expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(panelBox!.x + 1);
  expect(panelBox!.y).toBeLessThan(listBox!.y + listBox!.height);
  await page.screenshot({ path: testInfo.outputPath('1000-library.png') });
});

test('the deck editor collapses its task pane below 1024 px and keeps Present and Start session at 600 px', async ({ page }, testInfo) => {
  const api = await signIn(page);
  const created = await api.post('/api/decks', { headers: CSRF, data: { content: {
    version: 1, meta: { title: `Widths ${Date.now()}` }, steps: [
      { id: 'one', kind: 'title', title: 'Bonjour' },
      { id: 'two', kind: 'statement', layout: 'text', title: 'Au marché', body: 'On achète des pommes.' },
    ], interactions: [],
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const { deck } = await created.json() as { deck: { id: string } };
  const rail = page.getByRole('list', { name: 'Slides' });
  const canvas = page.locator('.slide-canvas__frame');
  const closePane = page.getByRole('button', { name: 'Close task pane' });
  const paneToggle = page.getByRole('button', { name: 'Slide pane', exact: true });

  // Desktop: three panes side by side, no toggle.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await expect(canvas).toBeVisible();
  await expect(closePane).toBeInViewport();
  await expect(paneToggle).toHaveCount(0);
  const [railBox, canvasBox, paneBox] = await Promise.all([rail.boundingBox(), canvas.boundingBox(), page.locator('.deck-editor-properties').boundingBox()]);
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(canvasBox!.x + 1);
  expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(paneBox!.x + 1);
  await expectNoSidewaysScroll(page, 'deck editor at 1280 px');

  // Tablet: the pane is closed and opens over the canvas; the rail still works.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(closePane).toHaveCount(0);
  await expect(paneToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rail).toBeVisible();
  await expect(canvas).toBeInViewport();
  await expectNoSidewaysScroll(page, 'deck editor at 900 px');
  await paneToggle.click();
  await expect(paneToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(closePane).toBeInViewport();
  const overlay = (await page.locator('.deck-editor-properties').boundingBox())!;
  const frame = (await canvas.boundingBox())!;
  expect(overlay.x, 'the pane lies over the canvas').toBeLessThan(frame.x + frame.width);
  await page.screenshot({ path: testInfo.outputPath('900-deck-editor-pane.png') });
  const second = rail.locator('[data-rail-row]').nth(1);
  await second.click();
  await expect(second).toHaveAttribute('aria-current', 'true');
  await closePane.focus();
  await page.keyboard.press('Escape');
  await expect(closePane).toHaveCount(0);
  await expect(paneToggle).toHaveAttribute('aria-expanded', 'false');

  // Phone: one line instead of the editor; Present and Start session still work.
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByText('Open this deck on a larger screen to edit it.', { exact: true })).toBeInViewport();
  await expect(canvas).toHaveCount(0);
  await expectNoSidewaysScroll(page, 'deck editor at 600 px');
  const present = page.locator('[data-deck-present]');
  const startSession = page.getByRole('button', { name: 'Start session', exact: true });
  await expect(present).toBeInViewport();
  await expect(startSession).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('600-deck-editor.png') });
  await present.click();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  await expect(presenter).toBeVisible();
  await page.reload();
  const launched = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await startSession.click();
  expect((await launched).status()).toBe(201);
  await expect(presenter.getByRole('button', { name: 'End session', exact: true }).first()).toBeVisible();
});
