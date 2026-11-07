/**
 * UC-60 — Rejoin a running lesson instead of starting a second one by accident.
 *
 * While a session of a deck and its student is live, the Library inspector,
 * the editor top bar and the Presenter show Live now with Rejoin beside Start
 * session. Start session still works, and asks once first: rejoin, or start
 * another. Escape in the Presenter closes that question, not the Presenter.
 * The editor top bar names the student the deck is linked to.
 */
import { test, expect, type Page } from '@playwright/test';

import { command, waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };

test.beforeAll(async () => { await waitForWorker(); });

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  return page.request;
}

test('a live deck offers Rejoin beside Start session, and Start asks once', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const api = await signIn(page);
  const stamp = Date.now();
  const studentName = `Léa ${stamp}`;
  const title = `Au café ${stamp}`;
  const created = await api.post('/api/tutoring/students', { headers: CSRF, data: { displayName: studentName, kind: 'person', experience: 'tutoring' } });
  expect(created.status()).toBe(201);
  const { student } = await created.json() as { student: { id: string; spaceId: string } };
  const deckRes = await api.post('/api/decks', { headers: CSRF, data: {
    spaceId: student.spaceId, studentId: student.id,
    content: { version: 1, meta: { title }, steps: [{ id: 'one', kind: 'title', title }], interactions: [] },
  } });
  expect(deckRes.status()).toBe(201);
  const { deck } = await deckRes.json() as { deck: { id: string } };
  const libraryUrl = `/host/#/space/${student.spaceId}?studentId=${student.id}&itemId=${deck.id}`;
  const liveOfDeck = async () => {
    const { sessions } = await (await api.get('/api/my/sessions')).json() as { sessions: { sessionCode: string; deckId?: string; ended: boolean }[] };
    return sessions.filter((session) => session.deckId === deck.id && !session.ended);
  };

  // Nothing is live: the inspector offers Start session alone.
  await page.goto(libraryUrl);
  const inspector = page.getByRole('complementary', { name: `${title} details` });
  await expect(inspector.getByRole('button', { name: 'Start session', exact: true })).toBeVisible();
  await expect(inspector.getByText('Live now', { exact: true })).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page).toHaveURL(/#\/sessions\/[A-Z0-9]+/);
  const code = /#\/sessions\/([A-Z0-9]+)/.exec(page.url())![1]!;

  try {
    // Back in the Library the inspector says the deck is live, beside Start session.
    await page.goto(libraryUrl);
    await expect(inspector.getByText('Live now', { exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Rejoin', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Start session', exact: true }).click();
    const ask = page.getByRole('dialog', { name: 'This deck is live now' });
    await expect(ask).toContainText(`A session of this deck with ${studentName} is still running.`);
    await ask.getByRole('button', { name: 'Rejoin', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/sessions/${code}`));
    expect((await liveOfDeck()).map((session) => session.sessionCode)).toEqual([code]);

    // The editor top bar names the student and offers the same way back in.
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    await expect(page.locator('[data-deck-student]')).toHaveText(studentName);
    const bar = page.locator('[data-deck-live-now]');
    await expect(bar).toContainText('Live now');
    await expect(bar.getByRole('button', { name: 'Rejoin', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(ask).toHaveCount(0);

    // The Presenter too; Escape closes the question and keeps the Presenter open.
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    await expect(presenter.locator('[data-deck-live-now]').getByRole('button', { name: 'Rejoin', exact: true })).toBeVisible();
    await presenter.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(ask).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(presenter).toBeVisible();
    expect((await liveOfDeck()).map((session) => session.sessionCode)).toEqual([code]);
  } finally {
    const host = await (await api.post(`/api/my/sessions/${code}/facilitate`, { headers: CSRF })).json() as { hostToken: string };
    await command(code, host.hostToken, { command: 'session.end' });
  }
});
