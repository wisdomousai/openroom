import { expect, type Locator } from '@playwright/test';
import { test } from '../fixtures/learner-browser';
import { stageUrl, waitForWorker } from '../fixtures/session';
import { designImage } from '../fixtures/design-images';
import { defaultDeckDesign } from '../../packages/schema/src/deck-design';
import type { Outline } from '../../packages/schema/src/outline-types';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

type Box = { x: number; y: number; w: number; h: number };

/** Boxes of the matched elements, in fractions of the slide width. */
async function boxes(surface: Locator, selector: string): Promise<Box[]> {
  return surface.evaluate(async (root, sel) => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const frame = root.getBoundingClientRect();
    return [...root.querySelectorAll(sel)].map((node) => {
      const box = node.getBoundingClientRect();
      return { x: (box.left - frame.left) / frame.width, y: (box.top - frame.top) / frame.width, w: box.width / frame.width, h: box.height / frame.width };
    });
  }, selector);
}

async function slideHeight(surface: Locator): Promise<number> {
  return surface.evaluate((root) => root.getBoundingClientRect().height / root.getBoundingClientRect().width);
}

async function loaded(surface: Locator) {
  for (const picture of await surface.locator('img').all()) {
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
}

test('long text, pictures, short grids, long lists and HTML fit their slide in the editor and on the stage', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
  const spaceResponse = await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: 'Slide fitting', experience: 'classroom' } });
  expect(spaceResponse.status()).toBe(201);
  const space = await spaceResponse.json();
  const uploaded = await page.request.post(`/api/tutoring/spaces/${space.id}/assets?name=composition.png`, { headers: { ...CSRF, 'content-type': 'image/png' }, data: await designImage(page) });
  expect(uploaded.status()).toBe(201);
  const { asset } = await uploaded.json();
  const picture = (place: 'right' | 'bottom', size?: number) => ({ type: 'image' as const, assetId: asset.id, url: `/api/assets/${asset.id}`, alt: 'Geometric composition', place, ...(size ? { size } : {}) });
  const content: Outline = {
    version: 1, meta: { title: 'Slide fitting' },
    design: { ...defaultDeckDesign('paper'), aspectRatio: '16:9' },
    interactions: [
      { id: 'many', type: 'choice', prompt: 'Which month comes next?', options: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, label: `Month ${i + 1}` })) },
      { id: 'bank', type: 'fill-the-gaps', prompt: 'The cat sat on the {{a}}.', display: 'bank', gaps: [{ id: 'a', answers: ['mat'] }], bank: Array.from({ length: 24 }, (_, i) => `word${i + 1}`) },
    ],
    steps: [
      { id: 'story', kind: 'statement', title: 'Read the story', body: 'A fox walked to the river to drink and saw the moon in the water. '.repeat(7).trim() },
      { id: 'beside', kind: 'statement', title: 'Look at the picture', body: 'Describe two things you notice.', media: picture('right') },
      { id: 'below', kind: 'steps', title: 'Work through it', items: ['Read the task', 'Underline the verbs', 'Find the subject', 'Write one sentence', 'Check the tense', 'Read it aloud'], media: picture('bottom', 30) },
      { id: 'two', kind: 'cards', title: 'Two examples', items: [{ text: 'She has lived here since 2019.' }, { text: 'They have finished the book.' }] },
      { id: 'twelve', kind: 'steps', title: 'Twelve steps', items: Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`) },
      { id: 'html', kind: 'blank', elements: [{ id: 'fixed', type: 'html', html: '<div style="position:fixed;inset:0;background:#c33;color:#fff">Fixed layer</div>', box: { x: 40, y: 40, w: 20, h: 20 } }] },
      { id: 'poll', kind: 'interaction', interactionId: 'many' },
      { id: 'gaps', kind: 'interaction', interactionId: 'bank' },
    ],
  };
  const created = await page.request.post('/api/decks', { headers: CSRF, data: { content, spaceId: space.id } });
  expect(created.status(), await created.text()).toBe(201);
  const { deck } = await created.json();
  await page.goto(`/host/#/decks/${deck.id}/edit`);
  const editor = page.locator('.slide-canvas__frame .slide-surface');
  const slides = page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button');
  const open = async (index: number, heading: string | RegExp) => {
    await slides.nth(index).click();
    await expect(editor.locator('[data-part="header"]')).toHaveText(heading);
    await loaded(editor);
  };
  const editorBoxes: Record<string, Box[]> = {};

  // A long statement starts at the top: the heading stays on the slide.
  await open(0, 'Read the story');
  editorBoxes.story = await boxes(editor, '[data-part="header"]');
  expect(editorBoxes.story[0]!.y).toBeGreaterThanOrEqual(0.07);
  await editor.screenshot({ path: testInfo.outputPath('story-editor.png') });

  // A picture placed right of the words draws as a split slide.
  await open(1, 'Look at the picture');
  await expect(editor.locator('.outline-step')).toHaveClass(/outline-step--layout-split/);
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  const [body] = await boxes(editor, '[data-part="body"]');
  const [image] = await boxes(editor, '[data-part="image"]');
  expect(image!.x).toBeGreaterThanOrEqual(body!.x + body!.w - 0.005);
  await editor.screenshot({ path: testInfo.outputPath('beside-editor.png') });

  // A picture placed under a list comes after the last item and stays on the slide.
  await open(2, 'Work through it');
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  const items = await boxes(editor, '[data-part^="cell-"]');
  const [below] = await boxes(editor, '[data-part="image"]');
  const last = items.at(-1)!;
  expect(below!.y).toBeGreaterThanOrEqual(last.y + last.h - 0.005);
  expect(below!.y + below!.h).toBeLessThanOrEqual(await slideHeight(editor));
  await editor.screenshot({ path: testInfo.outputPath('below-editor.png') });

  // Two short cards keep their own height instead of filling the slide.
  await open(3, 'Two examples');
  editorBoxes.two = await boxes(editor, '[data-part^="cell-"]');
  for (const card of editorBoxes.two) expect(card.h).toBeLessThan(0.15);

  // Twelve steps: every step number sits inside its own row.
  await open(4, 'Twelve steps');
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  const rows = await editor.evaluate((root) => [...root.querySelectorAll('.outline-step__sequence li')].map((row) => {
    const badge = row.querySelector(':scope > span:not([data-slide-decoration])')!.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return badge.top >= box.top - 0.5 && badge.bottom <= box.bottom + 0.5;
  }));
  expect(rows).toEqual(Array.from({ length: 12 }, () => true));
  await editor.screenshot({ path: testInfo.outputPath('twelve-editor.png') });

  // Seven answers use the compact row size and the last answer stays on the slide.
  await open(6, 'Which month comes next?');
  await expect(editor.locator('.outline-step__options')).toHaveAttribute('data-option-tier', 'compact');
  const answers = await boxes(editor, '[data-part^="option-"]');
  expect(answers).toHaveLength(7);
  await editor.screenshot({ path: testInfo.outputPath('poll-editor.png') });
  expect(answers.at(-1)!.y + answers.at(-1)!.h).toBeLessThanOrEqual(await slideHeight(editor) - 0.075);

  // A 24-word bank wraps as chips in a few lines.
  await open(7, /^The cat sat on the/);
  const [bank] = await boxes(editor, '.outline-step__word-bank');
  await editor.screenshot({ path: testInfo.outputPath('bank-editor.png') });
  expect(bank!.h).toBeLessThan(0.25);

  await slides.first().click();
  const launched = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const session = await (await launched).json();
  const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
  const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  await stage.goto(stageUrl(session));
  const wall = stage.locator('.stage__main .slide-surface');
  await expect(wall).toBeVisible();
  const show = async (index: number, text?: string) => {
    await presenter.getByRole('tablist', { name: 'Slides', exact: true }).getByRole('tab').nth(index).click();
    if (text) await expect(wall.locator('[data-part="header"]')).toHaveText(text);
    await loaded(wall);
  };

  // The editor and the stage give the long heading the same box.
  await show(0, 'Read the story');
  const [storyWall] = await boxes(wall, '[data-part="header"]');
  const [storyEditor] = editorBoxes.story;
  for (const axis of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(storyWall![axis] - storyEditor![axis]), `story/${axis}`).toBeLessThan(0.002);
  await wall.screenshot({ path: testInfo.outputPath('story-stage.png') });

  await show(1, 'Look at the picture');
  await expect(wall.locator('.outline-step')).toHaveClass(/outline-step--layout-split/);
  await wall.screenshot({ path: testInfo.outputPath('beside-stage.png') });

  await show(3, 'Two examples');
  const twoWall = await boxes(wall, '[data-part^="cell-"]');
  for (const [index, card] of twoWall.entries()) expect(Math.abs(card.h - editorBoxes.two[index]!.h), `card ${index}`).toBeLessThan(0.009);

  // An HTML layer fixed to the viewport stays inside its own box.
  await show(5);
  const host = wall.locator('.outline-step__element--html');
  await expect(host).toBeVisible();
  const escaped = await wall.evaluate((root) => {
    const frame = root.getBoundingClientRect();
    const element = root.querySelector('.outline-step__element--html')!;
    const corners = [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]].map(([x, y]) => document.elementFromPoint(frame.left + frame.width * x!, frame.top + frame.height * y!));
    return corners.some((hit) => hit !== null && element.contains(hit));
  });
  expect(escaped).toBe(false);
  await wall.screenshot({ path: testInfo.outputPath('html-stage.png') });
  await stage.close();
});
