import { test, expect, type Page } from '@playwright/test';
import { renderMarkdownToHtml } from '../../packages/schema/src/element-markdown';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';
import type { Outline } from '../../packages/schema/src/outline-types';
import { waitForWorker } from '../fixtures/session';

const CSRF = { 'x-openroom-csrf': '1' };
const longText = 'Explain the reasoning and give a concrete example. '.repeat(9);
const base = (): Outline => ({ version: 1, meta: { title: 'Overflow review' }, interactions: [], steps: [{ id: 'intro', kind: 'title', title: 'Welcome' }] });

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

async function openDeck(page: Page, content: Outline) {
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content } });
  expect(created.status(), await created.text()).toBe(201);
  const { deck } = await created.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  await expect(page.locator('.slide-canvas__frame')).toBeVisible();
}

async function saved(page: Page) {
  await expect(page.locator('[data-or-draft-status]')).toHaveAttribute('data-or-draft-status', 'saved');
}

test('homework grows as a document, keeps mixed content and reaches the final task', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 650 });
  const outline = base();
  outline.interactions = [{ id: 'question', type: 'choice', prompt: 'Choose an example. '.repeat(10), options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }];
  outline.homework = { title: 'Practice', body: 'Keep these instructions.', items: ['Keep this checklist.'], tasks: [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `reading-${i}`, kind: 'reading' as const, title: `Reading ${i + 1}`, body: longText })),
    { id: 'quiz', kind: 'quiz', interactionId: 'question' },
  ] };
  outline.recap = { title: 'Recap', body: longText, items: Array.from({ length: 20 }, (_, i) => `Point ${i + 1}`) };
  await openDeck(page, outline);
  await page.getByRole('button', { name: /^Homework / }).click();
  const document = page.getByRole('region', { name: 'Homework document' });
  await expect(document.getByLabel('homework body')).toHaveValue('Keep these instructions.');
  await expect(document.getByLabel('homework list')).toHaveValue('Keep this checklist.');
  for (const button of ['Add writing', 'Add voice response', 'Add reading', 'Add a quiz']) {
    await document.getByRole('button', { name: button, exact: true }).click();
    await expect(document.locator('[data-homework-task]').last().locator('input').first()).toBeFocused();
  }
  await expect(document.locator('[data-homework-task]')).toHaveCount(12);
  const last = document.locator('[data-homework-task]').last();
  await last.locator('input').first().fill('Final exercise');
  await last.locator('input').first().press('Tab');
  await saved(page);
  const fits = await document.evaluate((root) => {
    const paper = root.firstElementChild!.getBoundingClientRect();
    return root.scrollHeight > root.clientHeight && root.scrollWidth <= root.clientWidth + 1 &&
      [...root.querySelectorAll('[data-homework-task]')].every((task) => {
        const box = task.getBoundingClientRect();
        return box.left >= paper.left && box.right <= paper.right + 1 && box.bottom <= paper.bottom;
      });
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('homework-final-task.png') });

  // The duplicate prose controls must never clear a task-only homework page.
  await document.getByLabel('homework body').fill('');
  await document.getByLabel('homework list').fill('');
  const pane = page.locator('.deck-editor-properties');
  await pane.getByPlaceholder('Optional title').fill('');
  await saved(page);
  await page.reload();
  await page.getByRole('button', { name: /^Homework / }).click();
  await expect(document.locator('[data-homework-task]')).toHaveCount(12);
  await expect(document.locator('[data-homework-task]').last().locator('input').first()).toHaveValue('Final exercise');
  await document.locator('[data-homework-task]').last().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(document.locator('[data-homework-task]')).toHaveCount(11);
  await saved(page);
  await page.getByRole('button', { name: /^Recap / }).click();
  const recap = page.getByRole('region', { name: 'Recap document' });
  await page.setViewportSize({ width: 1000, height: 480 });
  await recap.getByLabel('recap list').fill('The final recap point');
  await recap.getByLabel('recap list').press('Tab');
  await saved(page);
  await expect(recap.getByLabel('recap list')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('recap-short-window.png') });
});

test('live overflow leads to editable text and clears after repair', async ({ page }, testInfo) => {
  await openDeck(page, base());
  const heading = page.locator('.slide-canvas__frame [data-part="header"]');
  await heading.fill('W'.repeat(290));
  // Still focused: the outline has not been saved yet.
  await expect(heading).toBeFocused();
  await expect(page.getByRole('button', { name: 'Review overflow' })).toBeVisible();
  await page.getByRole('button', { name: 'Review overflow' }).click();
  const issues = page.getByRole('region', { name: 'Slide overflow' });
  await issues.getByRole('button', { name: /^Heading / }).click();
  const editor = page.getByRole('textbox', { name: 'Heading text', exact: true });
  await expect(editor).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('overflow-review.png') });
  await editor.fill('A clear heading');
  await editor.press('Tab');
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(heading).toHaveText('A clear heading');
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
});

test('a single gap can be typed or use a word bank without extras', async ({ page }) => {
  await openDeck(page, base());
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.getByRole('button', { name: 'Question', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Fill the gaps', exact: true }).click();
  const sentence = dialog.getByRole('textbox', { name: 'The sentence' });
  await sentence.fill('Hello world');
  await sentence.press('ControlOrMeta+A');
  await dialog.getByRole('button', { name: 'Make a gap', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Typed answer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Word bank', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  const heading = page.locator('.slide-canvas__frame [data-part="header"]');
  await heading.click();
  const pane = page.locator('.deck-editor-properties');
  await expect(pane.getByRole('button', { name: 'Word bank', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await pane.getByRole('button', { name: 'Typed answer', exact: true }).click();
  await saved(page);
  await page.reload();
  await page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button').last().click();
  await heading.click();
  await expect(pane.getByRole('button', { name: 'Typed answer', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

for (const aspectRatio of ['16:9', '16:10', '4:3'] as const) {
  test(`${aspectRatio}: nested columns, lists, objects and HTML report clipping while reading scrolls`, async ({ page }, testInfo) => {
    const outline = base();
    outline.design = { ...defaultDeckDesign('paper'), aspectRatio };
    const markdown = Array.from({ length: 40 }, () => 'Reading material belongs in a scrolling document.').join('\n\n');
    outline.interactions = [
      { id: 'choices', type: 'choice', prompt: 'Choose one', options: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, label: `Option ${i + 1}: ${'Long answer '.repeat(6)}` })) },
      { id: 'gaps', type: 'fill-the-gaps', prompt: 'Complete {{a}}.', display: 'bank', gaps: [{ id: 'a', answers: ['hello'] }], bank: Array.from({ length: 20 }, (_, i) => `${i} ${'a long word bank entry '.repeat(2)}`) },
    ];
    outline.steps = [
      { id: 'column', kind: 'statement', layout: 'split', title: 'Read this', body: longText.repeat(4) },
      { id: 'cards', kind: 'cards', title: 'Examples', items: Array.from({ length: 8 }, () => ({ text: longText })) },
      { id: 'instructions', kind: 'activity', title: 'Work together', instructions: Array.from({ length: 10 }, () => longText) },
      { id: 'options', kind: 'interaction', interactionId: 'choices' },
      { id: 'bank', kind: 'interaction', interactionId: 'gaps' },
      { id: 'text', kind: 'blank', elements: [{ id: 'text-box', type: 'text', text: longText, box: { x: 10, y: 10, w: 25, h: 8 } }] },
      { id: 'html', kind: 'blank', elements: [{ id: 'html-box', type: 'html', html: '<div style="height:2000px">A tall HTML fragment</div>', box: { x: 10, y: 10, w: 60, h: 60 } }] },
      { id: 'caption', kind: 'media', layout: 'split', title: 'W'.repeat(280), media: { type: 'image', url: 'https://example.org/overflow-image.svg', alt: 'Example', caption: 'W'.repeat(1000) } },
      { id: 'reading', kind: 'blank', elements: [{ id: 'reading-box', type: 'html', markdown, html: renderMarkdownToHtml(markdown), box: { x: 10, y: 10, w: 80, h: 80 } }] },
    ];
    await page.route('https://example.org/overflow-image.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#335577"/></svg>' }));
    await openDeck(page, outline);
    const slides = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
    for (const [index, label] of ['Body', 'Item', 'Instruction', 'Answer', 'Word bank', 'Text box', 'HTML', 'Caption'].entries()) {
      await slides.nth(index).click();
      await expect(page.getByRole('button', { name: 'Review overflow' }), `overflow on ${label}`).toBeVisible();
      await page.getByRole('button', { name: 'Review overflow' }).click();
      const issues = page.getByRole('region', { name: 'Slide overflow' });
      await issues.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
      await expect(page.locator('.deck-editor-properties [data-editor-target]:not([data-editor-target="overflow"])').filter({ has: page.locator(':focus') })).not.toHaveCount(0);
    }
    await slides.nth(8).click();
    await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`reading-${aspectRatio.replace(':', '-')}.png`) });
  });
}
