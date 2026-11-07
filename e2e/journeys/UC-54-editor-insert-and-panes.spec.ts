/**
 * UC-54 — insert dialogs, pictures and the task pane in the deck editor.
 *
 * Dialog footers stay inside the dialog at 1280 and 390. The picture dialog's
 * sources are tabs. Image + text fills its own frame, an empty frame offers
 * Add picture, and a picture object has labelled Alt text and Crop. Words on
 * the slide can be looked up and formatted. The task pane tabs are tabs and
 * its close and reveal controls have names. Room audio and Individual
 * listening show which is on. A list slide that does not fit can move its
 * hidden items to a new slide. Filled material lines carry no placeholder.
 * Up and Down move through the rail, an html slide is drawn and named there,
 * the Slide tab fits at 1440 px, and the master logo and background have
 * headings.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { waitForWorker } from '../fixtures/session';
import type { Outline } from '../../packages/schema/src/outline-types';

const CSRF = { 'x-openroom-csrf': '1' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const deckOf = (steps: Outline['steps']): Outline => ({ version: 1, meta: { title: 'Insert deck' }, steps, interactions: [] });

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

async function openDeck(page: Page, content: Outline) {
  const login = await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  expect(login.ok(), await login.text()).toBe(true);
  const response = await page.request.post('/api/decks', { headers: CSRF, data: { content } });
  expect(response.status(), await response.text()).toBe(201);
  const { deck } = await response.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await expect(page.locator('.slide-canvas__frame')).toBeVisible();
  return deck as { id: string };
}

async function draftOf(page: Page, deckId: string): Promise<Outline> {
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
  const draft = await (await page.request.get(`/api/decks/${deckId}/draft`)).json();
  return parse(draft.source) as Outline;
}

/** Both boxes, so a failure names the numbers. */
async function expectInside(inner: Locator, outer: Locator) {
  const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  if (a === null || b === null) throw new Error('Both elements must be visible.');
  expect(a.x, `left ${JSON.stringify(a)} in ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(b.x);
  expect(a.y).toBeGreaterThanOrEqual(b.y);
  expect(a.x + a.width, `right ${JSON.stringify(a)} in ${JSON.stringify(b)}`).toBeLessThanOrEqual(b.x + b.width);
  expect(a.y + a.height, `bottom ${JSON.stringify(a)} in ${JSON.stringify(b)}`).toBeLessThanOrEqual(b.y + b.height);
}

test('Ask and picture dialogs keep Insert inside the dialog, and picture sources are tabs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDeck(page, deckOf([{ id: 'title', kind: 'title', title: 'Dialogs' }]));

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'New question' });
  await expectInside(ask.getByRole('button', { name: 'Insert', exact: true }), ask);
  await expectInside(ask.getByText(/^Lands as one slide/), ask);
  await page.screenshot({ path: testInfo.outputPath('ask-dialog-1280.png') });
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await page.getByRole('button', { name: 'Picture', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'Choose a picture' });
  const insert = picture.getByRole('button', { name: 'Insert', exact: true });
  await expectInside(insert, picture);
  const sources = picture.getByRole('tablist', { name: 'Where the picture comes from' });
  const stock = sources.getByRole('tab', { name: 'Stock photos', exact: true });
  await expect(stock).toHaveAttribute('aria-selected', 'true');
  await stock.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sources.getByRole('tab', { name: 'This space', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('picture-dialog-1280.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectInside(insert, picture);
  await expectInside(picture.getByRole('button', { name: 'Cancel', exact: true }), picture);
  for (const tab of await sources.getByRole('tab').all()) {
    const box = await tab.boundingBox();
    expect(box?.height ?? 0, 'a tab label stays on one line').toBeLessThanOrEqual(34);
  }
  const credit = picture.getByText('Credit the photographer on the slide');
  expect((await credit.boundingBox())?.height ?? 0, 'the credit label stays on one line').toBeLessThanOrEqual(24);
  await page.screenshot({ path: testInfo.outputPath('picture-dialog-390.png') });
});

test('Image + text fills its frame, an empty frame offers Add picture, and a picture object has alt text and crop', async ({ page }, testInfo) => {
  const deck = await openDeck(page, deckOf([{ id: 'title', kind: 'title', title: 'Pictures' }]));
  await page.getByRole('tab', { name: 'Slide', exact: true }).click();
  await page.getByRole('button', { name: 'Image + text', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'Choose a picture' });
  await expect(picture).toBeVisible();
  await picture.getByRole('button', { name: 'Cancel', exact: true }).click();

  const frame = page.locator('.slide-canvas__frame [data-part="el-pic"]');
  const add = frame.getByRole('button', { name: 'Add picture', exact: true });
  await expect(add).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('image-text-empty-frame.png') });
  // The selected frame wears its move chrome; select the slide first so the button is on top.
  await page.locator('.slide-canvas__frame .slide-surface').click({ position: { x: 20, y: 20 } });
  await add.click();
  await expect(picture).toBeVisible();
  await picture.getByRole('tab', { name: 'Upload', exact: true }).click();
  await picture.getByLabel('Picture file').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await expect(picture.locator('[data-upload-picked]')).toContainText('Uploaded to this space.');
  await picture.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(picture).toHaveCount(0);
  await expect(frame.locator('img')).toBeVisible();
  await expect(add).toHaveCount(0);

  const pane = page.locator('.deck-editor-properties');
  const alt = pane.getByRole('textbox', { name: 'Alt text', exact: true });
  await expect(alt).toHaveValue('');
  await expect(pane.locator('[data-picture-alt]')).toContainText('Alt text');
  await alt.fill('A grey cat on a chair');
  await alt.press('Tab');
  await pane.getByRole('group', { name: 'Crop focus' }).getByRole('button', { name: 'top', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('image-text-filled.png') });
  const saved = await draftOf(page, deck.id);
  const slide = saved.steps.find((step) => step.kind === 'blank');
  const element = slide && 'elements' in slide ? slide.elements?.find((item) => item.id === 'pic') : undefined;
  expect(element).toMatchObject({ type: 'image', alt: 'A grey cat on a chair', focal: 'top' });
});

async function pointAt(page: Page, word: string) {
  return page.locator('.slide-canvas__frame').evaluate((frame, target) => {
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(target) ?? -1;
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at + 1);
      range.setEnd(node, at + 2);
      const rect = range.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null })
        .caretPositionFromPoint?.(x, y)?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
      if (rect.width > 0 && hit === node) return { x, y };
    }
    return null;
  }, word);
}

test('a word on the slide can be looked up and bolded', async ({ page }, testInfo) => {
  await page.route('**/api/tutoring/dictionary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    entry: { word: 'rate', lemma: 'rater', lang: 'fr', pos: 'verb', headword: 'rater', labels: [], senses: [{ gloss: 'to miss' }], sections: [], source: { name: 'Wiktionary', url: 'https://fr.wiktionary.org/wiki/rater' } },
    meaning: 'to miss',
  }) }));
  const deck = await openDeck(page, deckOf([{ id: 'title', kind: 'title', title: 'Je rate le train' }]));
  const point = await pointAt(page, 'rate');
  if (point === null) throw new Error('"rate" is not reachable on the slide.');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Look up “rate”' }).click();
  await expect(page.locator('.deck-editor-properties')).toContainText('to miss');
  await page.screenshot({ path: testInfo.outputPath('canvas-look-up.png') });

  const heading = page.locator('.slide-canvas__frame [data-part="header"]');
  await heading.click();
  await heading.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf('train') ?? -1;
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'train'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
  });
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('canvas-format-toolbar.png') });
  await page.keyboard.press('ControlOrMeta+B');
  await page.locator('.slide-canvas__frame .slide-surface').click({ position: { x: 10, y: 10 } });
  const saved = await draftOf(page, deck.id);
  expect(saved.steps[0]).toMatchObject({ titleSpans: expect.arrayContaining([expect.objectContaining({ text: 'train', bold: true })]) });
});

test('pane tabs are tabs, and the close and reveal controls are named', async ({ page }, testInfo) => {
  await openDeck(page, deckOf([{
    id: 'list', kind: 'steps', title: 'Plan', items: ['Read', 'Write', 'Speak'],
    reveal: [['header'], ['cell-0', 'cell-1'], ['cell-2']],
  }]));
  await expect(page.getByRole('tablist', { name: 'Ribbon', exact: true })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Task pane', exact: true });
  const design = tabs.getByRole('tab', { name: 'Design', exact: true });
  await expect(design).toHaveAttribute('aria-selected', 'true');
  await design.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Theme', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(design).toHaveAttribute('aria-selected', 'true');

  const pane = page.locator('.deck-editor-properties');
  await expect(pane.getByRole('button', { name: 'Merge step 2 with step 3', exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Show Item 1 as its own step', exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Move Item 3 earlier', exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Move Item 3 later', exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Show Item 1 as its own step', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('reveal-controls.png') });
  await pane.getByRole('button', { name: 'Close task pane', exact: true }).click();
  await expect(pane).toHaveCount(0);
});

test('the listening mode shows which one is on', async ({ page }, testInfo) => {
  await openDeck(page, deckOf([{
    id: 'listen', kind: 'media', title: 'Listen', layout: 'media',
    media: { type: 'audio', url: 'https://local.openroom.invalid/openroom-pending-audio', alt: 'Station', listening: { mode: 'room' } },
  }]));
  const mode = page.locator('.deck-editor-properties').getByRole('group', { name: 'Listening mode' });
  const room = mode.getByRole('button', { name: 'Room audio', exact: true });
  const individual = mode.getByRole('button', { name: 'Individual listening', exact: true });
  await expect(room).toHaveAttribute('aria-pressed', 'true');
  const fill = (button: Locator) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await fill(room)).not.toBe(await fill(individual));
  await expect(room.locator('svg')).toHaveCount(1);
  await expect(individual.locator('svg')).toHaveCount(0);
  await individual.click();
  await expect(individual).toHaveAttribute('aria-pressed', 'true');
  await expect(individual.locator('svg')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await mode.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('listening-mode.png') });
});

test('a list slide that does not fit moves its hidden items to a new slide', async ({ page }, testInfo) => {
  const items = Array.from({ length: 12 }, (_, index) => `Read paragraph ${String(index + 1)} aloud`);
  const deck = await openDeck(page, deckOf([{ id: 'list', kind: 'steps', title: 'Reading routine', layout: 'text', items }]));
  await page.getByRole('button', { name: 'Review overflow' }).click();
  const issues = page.getByRole('region', { name: 'Slide overflow' });
  await expect(issues).toContainText('move the items that do not fit to a new slide');
  await expect(issues).not.toContainText('resize its box');
  const split = issues.getByRole('button', { name: /^Move Item \d+ and the rest to a new slide$/ });
  const label = (await split.textContent()) ?? '';
  const at = Number(/Item (\d+)/.exec(label)?.[1]) - 1;
  expect(at).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('overflow-split-offer.png') });
  await split.click();
  await expect(page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('overflow-split-done.png') });
  const saved = await draftOf(page, deck.id);
  expect(saved.steps.map((step) => (step.kind === 'steps' ? step.items.length : 0))).toEqual([at, items.length - at]);
  expect(saved.steps.every((step) => step.kind === 'steps' && step.title === 'Reading routine')).toBe(true);
});

test('filled material lines show their text without the placeholder', async ({ page }, testInfo) => {
  await openDeck(page, deckOf([{
    id: 'tower', kind: 'activity', title: 'Build the tallest tower',
    instructions: ['Form groups of four'], materials: ['Worksheet A', 'Pencil', 'Dictionary'],
  }]));
  const lines = page.locator('.slide-canvas__frame .outline-step__materials li');
  await expect(lines.first()).toHaveText('Worksheet A');
  for (const line of await lines.all()) await expect(line).not.toHaveAttribute('data-empty', 'true');
  await page.screenshot({ path: testInfo.outputPath('material-lines.png') });
});

test('the rail moves with Up and Down, draws and names an html slide, and the Slide tab fits at 1440', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDeck(page, deckOf([
    { id: 'opening', kind: 'title', title: 'Opening' },
    { id: 'drawing', kind: 'blank', elements: [{ id: 'sun', type: 'html', html: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', box: { x: 10, y: 10, w: 40, h: 40 } }] },
    { id: 'closing', kind: 'title', title: 'Closing' },
  ]));
  const rows = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
  await expect(rows.nth(1)).toContainText('Drawing');
  await expect(rows.nth(1).locator('.outline-step__element--html')).toHaveCount(1);
  await rows.nth(0).click();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');

  await page.getByRole('tab', { name: 'Slide', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('slide-ribbon-1440.png') });
  for (const name of ['Match', 'Break', 'Breakout']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect((box?.x ?? Infinity) + (box?.width ?? 0), `${name} is on screen`).toBeLessThanOrEqual(1440);
  }

  await page.getByRole('tab', { name: 'Theme', exact: true }).click();
  const pane = page.locator('.deck-editor-properties');
  await expect(pane.getByRole('heading', { name: /^Logo · / })).toHaveCount(1);
  await expect(pane.getByRole('heading', { name: /^Background · / })).toHaveCount(1);
});
