/**
 * UC-53 — the deck editor recovers instead of dead-ending.
 *
 * History opens any version again, the latest included. A tab whose deck was
 * stamped elsewhere offers the conflict choice instead of retrying forever; a
 * deck moved to Trash while open offers Restore and saves after it. A
 * reload during a lesson shows Live now · Rejoin, and a second Start asks
 * first. A missing deck says so. The picture dialog checks a link and an
 * upload before Insert. The dictionary offers the language pair and a retry.
 * The homework page names its student and the question Start is waiting for.
 */
import { test, expect, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { waitForWorker } from '../fixtures/session';
import type { Outline } from '../../packages/schema/src/outline-types';

const CSRF = { 'x-openroom-csrf': '1' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const titled = (title: string): Outline => ({
  version: 1,
  meta: { title: 'Recovery deck' },
  steps: [{ id: 'title', kind: 'title', title }],
  interactions: [],
});

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'bob', password: 'demo' } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function createDeck(page: Page, content: Outline, extra: Record<string, unknown> = {}) {
  const response = await page.request.post('/api/decks', { headers: CSRF, data: { content, ...extra } });
  expect(response.status(), await response.text()).toBe(201);
  const { deck } = await response.json();
  return deck as { id: string; spaceId: string };
}

async function stamp(page: Page, deckId: string, content: Outline, baseVersion: number) {
  const response = await page.request.post(`/api/decks/${deckId}/versions`, { headers: CSRF, data: { content, baseVersion } });
  expect(response.status(), await response.text()).toBe(201);
}

async function open(page: Page, deckId: string) {
  await page.goto(`/host/#/decks/${deckId}/edit`);
  await expect(page.locator('.slide-canvas__frame')).toBeVisible();
}

const versionRow = (page: Page, version: number) =>
  page.locator('li').filter({ has: page.getByText(`v${version}`, { exact: true }) });

test('History opens an older version and then the latest again, and asks before replacing a draft', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('First version'));
  await stamp(page, deck.id, titled('Second version'), 1);
  await open(page, deck.id);
  const frame = page.locator('.slide-canvas__frame');
  await expect(frame).toContainText('Second version');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(versionRow(page, 2)).toContainText('latest · open');
  await expect(versionRow(page, 2).getByRole('button', { name: 'Restore' })).toHaveCount(0);

  await versionRow(page, 1).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(frame).toContainText('First version');
  await expect(versionRow(page, 1)).toContainText('open');
  await page.screenshot({ path: testInfo.outputPath('history-after-restore.png') });

  // The latest can be opened again.
  await versionRow(page, 2).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(frame).toContainText('Second version');
  await expect(versionRow(page, 2)).toContainText('latest · open');

  // Unsaved work makes Restore ask first.
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('textbox', { name: /^Notes for / }).fill('Ask about the weekend first.');
  await expect(page.getByText('Saved with the deck. Students never see these notes.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await versionRow(page, 1).getByRole('button', { name: 'Restore', exact: true }).click();
  const confirm = page.getByRole('group', { name: 'Restore v1' });
  await expect(confirm).toContainText('Replace the open draft with v1? Your unsaved edits are not kept.');
  await page.screenshot({ path: testInfo.outputPath('history-confirm.png') });
  await confirm.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(frame).toContainText('First version');
});

test('a tab whose deck was stamped elsewhere offers the conflict choice and re-bases', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('Opened here'));
  await open(page, deck.id);
  // Another tab stamps a version.
  await stamp(page, deck.id, titled('Stamped elsewhere'), 1);
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('textbox', { name: /^Notes for / }).fill('An edit on the stale base.');
  const banner = page.getByRole('alert').filter({ hasText: 'This deck was changed somewhere else since you opened it.' });
  await expect(banner).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stale-tab-conflict.png') });
  await banner.getByRole('button', { name: 'Use saved version', exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.slide-canvas__frame')).toContainText('Stamped elsewhere');
  const draft = await (await page.request.get(`/api/decks/${deck.id}/draft`)).json();
  expect(draft.baseVersion).toBe(2);

  // With nothing unsaved here, coming back to the tab takes a newer version.
  await stamp(page, deck.id, titled('Third version'), 2);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.slide-canvas__frame')).toContainText('Third version');
  await expect(banner).toHaveCount(0);
});

test('a deck moved to Trash while open stops autosave with Restore instead of the conflict choice', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('Trashed while open'));
  await open(page, deck.id);
  const trashed = await page.request.delete(`/api/decks/${deck.id}`, { headers: CSRF });
  expect(trashed.ok(), await trashed.text()).toBe(true);
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('textbox', { name: /^Notes for / }).fill('Typed after the deck went to Trash.');
  const notice = page.getByRole('alert').filter({ hasText: 'This deck is in Trash' });
  await expect(notice).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'changed somewhere else' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('trashed-while-open.png') });
  await notice.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  const draft = await (await page.request.get(`/api/decks/${deck.id}/draft`)).json();
  expect(draft.source).toContain('Typed after the deck went to Trash.');
});

test('after a reload the editor shows the live session and asks before a second start', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('Live lesson'));
  await open(page, deck.id);
  const launched = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  expect((await launched).status()).toBe(201);
  await expect(page.getByRole('dialog', { name: 'Presenter', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('.slide-canvas__frame')).toBeVisible();
  const live = page.locator('[data-deck-live-now]');
  await expect(live).toContainText('Live now');
  await page.screenshot({ path: testInfo.outputPath('editor-live-now.png') });

  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'This deck is live now' });
  await expect(confirm).toContainText('A session of this deck is still running.');
  await page.screenshot({ path: testInfo.outputPath('start-while-live.png') });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);

  await live.getByRole('button', { name: 'Rejoin', exact: true }).click();
  await expect(page).toHaveURL(/#\/sessions\/[^/?]+/);
});

test('a deck that does not exist says so and leads back to the Library', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/host/#/decks/does-not-exist/edit');
  await expect(page.getByRole('heading', { name: 'This deck is not available' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('deck-not-available.png') });
});

test('the picture dialog checks a link and an upload before Insert', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('Pictures'));
  await page.route('https://pictures.test/**', (route) =>
    route.request().url().endsWith('/cat.png')
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      : route.fulfill({ status: 404, contentType: 'text/html', body: '<p>missing</p>' }));
  await open(page, deck.id);
  await page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await page.getByRole('button', { name: 'Picture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a picture' });
  const insert = dialog.getByRole('button', { name: 'Insert', exact: true });
  await dialog.getByRole('tab', { name: 'From a link', exact: true }).click();
  const address = dialog.getByLabel('Picture address');

  await address.fill('hello world');
  await address.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Enter a full address that starts with https://.');
  await expect(insert).toBeDisabled();

  await address.fill('https://pictures.test/broken.png');
  await address.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('This address does not return a picture.');
  await expect(insert).toBeDisabled();

  await address.fill('https://pictures.test/cat.png');
  await address.press('Enter');
  await expect(dialog.locator('[data-link-preview="shown"]')).toBeVisible();
  await expect(insert).toBeEnabled();
  await expect(dialog.locator('[data-picture-online-note]')).toHaveText(
    'This picture stays online. Upload it into this space before you use Save a copy.',
  );
  await page.screenshot({ path: testInfo.outputPath('picture-link-preview.png') });

  await dialog.getByRole('tab', { name: 'Upload', exact: true }).click();
  const file = dialog.getByLabel('Picture file');
  await file.setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('these are notes, not a picture') });
  await expect(dialog.getByRole('alert')).toContainText('This file type cannot be uploaded here.');
  await expect(insert).toBeDisabled();
  await file.setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  const picked = dialog.locator('[data-upload-picked]');
  await expect(picked).toContainText('cat.png');
  await expect(picked).toContainText('Uploaded to this space.');
  await expect(picked.getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
  await expect(insert).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('picture-upload-picked.png') });
  await insert.click();
  await expect(page.locator('.slide-canvas__frame img').first()).toBeVisible();
});

async function lookUp(page: Page, word: string) {
  const box = await page.locator('.slide-canvas__frame').evaluate((frame, target) => {
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
    const seen: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(target) ?? -1;
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at + 1);
      range.setEnd(node, at + 2);
      const rect = range.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      // The slide also renders a measuring copy; take the text the pointer reaches.
      const hit = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null })
        .caretPositionFromPoint?.(x, y)?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
      seen.push(`${rect.x},${rect.y},${rect.width} hit=${hit === node}`);
      if (rect.width > 0 && hit === node) return { x, y, seen };
    }
    return { x: -1, y: -1, seen };
  }, word);
  if (box.x < 0) throw new Error(`"${word}" is not reachable on the slide: ${box.seen.join(' | ')}`);
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.getByRole('menuitem', { name: `Look up “${word}”` }).click();
}

test('the dictionary offers the language pair, says when it is offline and stays on the Design tab', async ({ page }, testInfo) => {
  await signIn(page);
  const deck = await createDeck(page, titled('Bonjour Paris'));
  let mode: 'no-pair' | 'offline' = 'no-pair';
  await page.route('**/api/tutoring/dictionary', (route) => mode === 'offline'
    ? route.abort('internetdisconnected')
    : route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'languages-not-configured', spaceId: deck.spaceId, canEdit: true }) }));
  await open(page, deck.id);

  await lookUp(page, 'Bonjour');
  const pair = page.locator('[data-dictionary-pair]');
  await expect(pair).toContainText('Choose the language you teach and the one your students speak.');
  await expect(pair.getByRole('button', { name: 'Save and look up', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('dictionary-no-pair.png') });

  mode = 'offline';
  await lookUp(page, 'Paris');
  const failure = page.getByRole('alert').filter({ hasText: 'OpenRoom could not be reached.' });
  await expect(failure).toBeVisible({ timeout: 3000 });
  await expect(failure.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dictionary-offline.png') });

  await page.getByRole('tab', { name: 'Theme', exact: true }).click();
  await expect(failure).toHaveCount(0);
});

test('the homework page names its student and Start shows the unfinished quiz', async ({ page }, testInfo) => {
  await signIn(page);
  const { student } = await (await page.request.post('/api/tutoring/students', { headers: CSRF, data: { displayName: 'Camille', kind: 'person', experience: 'tutoring' } })).json();
  const outline: Outline = {
    version: 1,
    meta: { title: 'Homework deck' },
    steps: [
      { id: 'title', kind: 'title', title: 'Lesson' },
      { id: 'gaps', kind: 'interaction', interactionId: 'gaps' },
      { id: 'order', kind: 'interaction', interactionId: 'order' },
    ],
    interactions: [
      { id: 'gaps', type: 'fill-the-gaps', prompt: 'Je {{verb}} le train.', gaps: [{ id: 'verb', answers: ['rate'] }] },
      { id: 'order', type: 'ranking', prompt: 'Rank the trips', options: [{ id: 'a', label: 'Paris' }, { id: 'b', label: 'Lyon' }] },
      { id: 'quiz', type: 'choice', prompt: '', options: [{ id: 'x', label: '' }, { id: 'y', label: '' }] },
    ],
    homework: { title: 'Practice', tasks: [{ id: 'task-quiz', kind: 'quiz', interactionId: 'quiz' }] },
  } as Outline;
  const deck = await createDeck(page, outline, { studentId: student.id, spaceId: student.spaceId });
  await open(page, deck.id);

  const readiness = page.locator('#question-readiness');
  await expect(readiness).toContainText('Complete the homework quiz before starting');
  await readiness.getByRole('button', { name: 'Show the question', exact: true }).click();
  const homework = page.getByRole('region', { name: 'Homework document' });
  await expect(homework).toBeVisible();
  await expect(homework.locator('[data-homework-recipient]')).toHaveText('For Camille · shared when you save Notes after the lesson');
  await expect(homework.getByLabel('Quiz question', { exact: true })).toBeFocused();
  await expect(page.locator('footer')).toContainText('Homework · one task');
  await expect(page.getByText('These tools work on slides. Select a slide in the rail to use them.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('homework-recipient.png') });

  // Reuse lists gaps as blanks and refuses a ranking without a correct order.
  await homework.getByRole('combobox', { name: 'A question in this deck' }).click();
  await expect(page.getByRole('option', { name: 'Je ____ le train.' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Rank the trips (needs a correct order)' })).toHaveAttribute('aria-disabled', 'true');
  await page.screenshot({ path: testInfo.outputPath('homework-reuse.png') });
  await page.keyboard.press('Escape');
});

test('a match shows its pairs in the pane, and only a choice offers Mark correct', async ({ page }, testInfo) => {
  await signIn(page);
  const outline = {
    version: 1,
    meta: { title: 'Match deck' },
    steps: [{ id: 'pairs', kind: 'interaction', interactionId: 'm' }],
    interactions: [{ id: 'm', type: 'match', prompt: 'Match the animals', left: [{ id: 'l1', label: 'chat' }, { id: 'l2', label: 'chien' }], right: [{ id: 'r1', label: 'cat' }, { id: 'r2', label: 'dog' }], correct: { l1: 'r1', l2: 'r2' } }],
  } as Outline;
  const deck = await createDeck(page, outline);
  await open(page, deck.id);
  const answer = page.getByRole('textbox', { name: 'Answer paired with chat', exact: true });
  await expect(answer).toHaveValue('cat');
  // Selecting a left item opens its part; a match has no single correct option.
  await page.locator('.slide-canvas__frame [data-part="option-0"]').click();
  await expect(page.getByRole('button', { name: /Mark correct|Correct/ })).toHaveCount(0);
  await answer.fill('kitten');
  await answer.press('Enter');
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  const draft = await (await page.request.get(`/api/decks/${deck.id}/draft`)).json();
  const saved = parse(draft.source) as Outline;
  expect(saved.interactions[0]).toMatchObject({ right: [{ id: 'r1', label: 'kitten' }, { id: 'r2', label: 'dog' }], correct: { l1: 'r1', l2: 'r2' } });
  await page.screenshot({ path: testInfo.outputPath('match-pairs.png') });
});
