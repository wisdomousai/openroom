/**
 * UC-51 — Notes after a lesson.
 *
 * A tutor ends a lesson, leaves its Notes unwritten, and finds the Library
 * prompt for it straight away, naming the student and the deck. The Notes page
 * names the student and says where the Next session note appears. Notes kept
 * on this device join the private notes on request. Re-saving an older
 * session's Notes leaves the Next session note written by a later session.
 * A refused save names what stays on this device and downloads every field.
 * The paid-plan lock and a failed load show their own screens, and notes can
 * be saved again once access returns.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };

test.beforeAll(async () => { await waitForWorker(); });

test('notes after a lesson: Library prompt, student name, device notes and the Next session note', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'cara', password: 'demo' } });
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  const studentName = `Lou ${Date.now()}`;
  const { student } = await (await page.request.post('/api/tutoring/students', { headers: CSRF, data: { displayName: studentName, kind: 'person', experience: 'tutoring' } })).json();
  const createDeck = async (title: string, createSession = false) => (await (await page.request.post('/api/decks', { headers: CSRF, data: { studentId: student.id, spaceId: student.spaceId, createSession,
    content: { version: 1, meta: { title }, steps: [{ id: 'title', kind: 'title', title }], interactions: [] },
  } })).json());
  await createDeck('Au café');
  const prompt = page.getByRole('link', { name: `Write the notes for ${studentName}’s session, Au café`, exact: true });

  // Starting from the Library loads its Live now list while the lesson runs;
  // after the lesson that cached list must not offer to rejoin it.
  await page.goto(`/host/#/space/${student.spaceId}?studentId=${student.id}`);
  await expect(page.getByRole('heading', { name: studentName, exact: true })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  const launched = page.waitForResponse((response) => /\/api\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('listbox', { name: 'Library' }).getByRole('option', { name: /^Au café/ }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Start session', exact: true }).click();
  const sessionId = /\/sessions\/([^/]+)\/launch$/.exec((await launched).url())![1]!;
  await page.getByRole('banner').getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('dialog', { name: 'End this session?', exact: true }).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/record`));
  await expect(page.getByRole('heading', { level: 1, name: `Session notes — ${studentName}, Au café`, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^Rejoin ${studentName}`) })).toHaveCount(0);

  await prompt.click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/record`));
  const nextSession = page.getByLabel('Next session', { exact: true });
  await expect(nextSession).toHaveAccessibleDescription(`Tutors only. Shown with ${studentName} in the Library and at the top of their next deck. 2000 characters left`);
  await nextSession.fill('NEXT FROM THE FIRST LESSON');
  await expect(page.getByText('1974 characters left', { exact: true })).toBeVisible();
  // The student has no access link yet: the page says so and offers to make one.
  await expect(page.getByText('This student has no access link, so they won\'t see these outcomes or homework yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an access link (opens in a new tab)', exact: true })).toHaveAttribute('href', new RegExp(`/tutor/students/${student.id}/links/new`));
  await page.getByLabel('Tutor notes', { exact: true }).fill('SAVED NOTE');
  await page.screenshot({ path: testInfo.outputPath('notes-first-lesson.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/space/${student.spaceId}`));
  await expect(prompt).toHaveCount(0);

  // A later lesson writes its own Next session note.
  const second = await createDeck('Au marché', true);
  expect((await page.request.post(`/api/sessions/${second.session.id}/launch`, { headers: CSRF, data: { start: true } })).status()).toBe(201);
  expect((await page.request.put(`/api/sessions/${second.session.id}/record`, { headers: CSRF, data: { outcomes: [], notes: '', nextNote: 'NEXT FROM THE SECOND LESSON', homework: [], artifacts: [] } })).status()).toBe(200);

  // Private notes typed on this device stay here until they are added and saved.
  await page.evaluate((id) => { location.hash = `/sessions/${id}/record`; }, sessionId);
  await page.getByLabel('Tutor notes', { exact: true }).fill('DEVICE NOTE');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.evaluate((id) => { location.hash = `/sessions/${id}/record`; }, sessionId);
  const device = page.getByRole('region', { name: 'Unsaved tutor notes', exact: true });
  await expect(device).toContainText('DEVICE NOTE');
  await expect(page.getByLabel('Tutor notes', { exact: true })).toHaveValue('SAVED NOTE');
  await device.getByRole('button', { name: 'Add to private notes', exact: true }).click();
  await expect(page.getByLabel('Tutor notes', { exact: true })).toHaveValue('SAVED NOTE\n\nDEVICE NOTE');
  await expect(nextSession).toHaveValue('NEXT FROM THE FIRST LESSON');
  await page.getByRole('button', { name: 'Update notes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/space/${student.spaceId}`));

  const saved = (await (await page.request.get(`/api/sessions/${sessionId}/record`)).json()).record;
  expect(saved.notes).toBe('SAVED NOTE\n\nDEVICE NOTE');
  expect(saved.nextNote).toBe('NEXT FROM THE FIRST LESSON');
  const current = (await (await page.request.get(`/api/tutoring/students/${student.id}`)).json()).student;
  expect(current.nextNote).toBe('NEXT FROM THE SECOND LESSON');

  // When shared saving is refused, the alert names what stays on this device and the download carries every text field.
  await page.evaluate((id) => { location.hash = `/sessions/${id}/record`; }, sessionId);
  await page.route('**/api/sessions/*/record', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 403, json: { error: 'forbidden' } }) : route.continue());
  await page.getByLabel('Outcomes (one per line)', { exact: true }).fill('Ordered a coffee');
  await nextSession.fill('NEXT AFTER ACCESS CHANGED');
  await page.getByRole('button', { name: 'Update notes', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Your access changed, so these notes were not saved. Tutor notes are kept on this device. Download notes to keep the outcomes, Next session and tutor notes.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download notes', exact: true }).click()]);
  expect(readFileSync((await download.path())!, 'utf8')).toBe('Outcomes\nOrdered a coffee\n\nNext session\nNEXT AFTER ACCESS CHANGED\n\nTutor notes\nSAVED NOTE\n\nDEVICE NOTE');
  await page.screenshot({ path: testInfo.outputPath('notes-access-changed.png'), fullPage: true });

  // The paid-plan lock on a refused save keeps the form's text and names what stays on this device.
  await page.unroute('**/api/sessions/*/record');
  await page.route('**/api/sessions/*/record', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 403, json: { error: 'continuity-required' } }) : route.continue());
  await page.reload();
  await page.getByLabel('Outcomes (one per line)', { exact: true }).fill('Ordered tea');
  await page.getByRole('button', { name: 'Update notes', exact: true }).click();
  await expect(page.locator('[data-or-lock="continuity"]')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Shared notes not saved. Tutor notes are kept on this device. Download notes to keep the outcomes, Next session and tutor notes.');
  await expect(page.getByLabel('Outcomes (one per line)', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Update notes', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('notes-plan-lock-on-save.png'), fullPage: true });

  // The lock on load replaces the form and leaves the notes on this device in reach.
  await page.unroute('**/api/sessions/*/record');
  await page.route('**/api/sessions/*/record', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 403, json: { error: 'continuity-required' } }) : route.continue());
  await page.reload();
  await expect(page.locator('[data-or-lock="continuity"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notes on this device', exact: true }).getByRole('textbox')).toHaveValue('SAVED NOTE\n\nDEVICE NOTE');
  await expect(page.getByRole('button', { name: 'Update notes', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('notes-plan-lock-on-load.png'), fullPage: true });

  // A failed load names itself, offers Retry and the Library, and keeps the notes on this device.
  await page.unroute('**/api/sessions/*/record');
  await page.route('**/api/sessions/*/record', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: 'internal' } }) : route.continue());
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Session notes could not be loaded', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to library', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notes on this device', exact: true }).getByRole('textbox')).toHaveValue('SAVED NOTE\n\nDEVICE NOTE');
  await page.screenshot({ path: testInfo.outputPath('notes-load-error.png'), fullPage: true });

  // Recovery: once access returns, Retry loads the form and the notes save.
  await page.unroute('**/api/sessions/*/record');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByLabel('Outcomes (one per line)', { exact: true }).fill('Ordered tea');
  await page.getByRole('button', { name: 'Update notes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/space/${student.spaceId}`));
  expect((await (await page.request.get(`/api/sessions/${sessionId}/record`)).json()).record.outcomes).toEqual(['Ordered tea']);
});
