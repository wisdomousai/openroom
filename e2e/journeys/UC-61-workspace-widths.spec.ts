/**
 * UC-61 — Which workspace pages fit a phone, and what the Library does instead.
 *
 * Add student, Space settings, Sample lessons, a session's Notes and Review
 * learner work fit a 390 px window with no sideways scroll, as Settings does.
 * The Library keeps its 980 px minimum and says so in one line below it; from
 * 980 px up its tree, list and inspector stay side by side. A student's own
 * space opens as that student's view, with a quiet Notes group: titles only,
 * a repeated title told apart by a silent ordinal.
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
  const student = `Noor ${stamp}`;
  const title = `Au café ${stamp}`;
  const created = await api.post('/api/tutoring/contexts', { headers: CSRF, data: { displayName: student, kind: 'person', experience: 'tutoring' } });
  expect(created.status()).toBe(201);
  const { context } = await created.json() as { context: { id: string; spaceId: string } };
  // Two lessons of one deck title, each with saved Notes.
  const sessionIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const deckRes = await api.post('/api/decks', { headers: CSRF, data: {
      spaceId: context.spaceId, contextId: context.id, createSession: true,
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
    ['Add student', '/host/#/tutor/contexts/new?experience=tutoring'],
    ['Space settings', `/host/#/space/${context.spaceId}/edit`],
    ['Sample lessons', `/host/#/space/${context.spaceId}/samples?contextId=${context.id}`],
    ['Notes', `/host/#/sessions/${sessionIds[0]}/record`],
    ['Review learner work', `/host/#/tutor/contexts/${context.id}/work`],
  ];
  for (const [label, url] of pages) {
    await page.goto(url);
    await expect(page.locator('main h1').first(), label).toBeVisible();
    await expect(page.getByText(NOTICE)).toHaveCount(0);
    await expectNoSidewaysScroll(page, label);
    await page.screenshot({ path: testInfo.outputPath(`390-${label.toLowerCase().replace(/ /g, '-')}.png`) });
  }

  // The Library keeps its desktop width and says so in one line.
  await page.goto(`/host/#/space/${context.spaceId}`);
  await expect(page.getByText(NOTICE)).toBeVisible();
  await expect(page.getByText(NOTICE)).toBeInViewport();

  // A student's own space opens as the student's view, with their Notes.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page).toHaveURL(new RegExp(`contextId=${context.id}`));
  await expect(page.getByRole('heading', { name: student, level: 1, exact: true })).toBeVisible();
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
