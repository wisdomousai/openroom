import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '../fixtures/learner-browser';
import { command, stageUrl, waitForWorker } from '../fixtures/session';
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

/** A tall synthetic picture, twice as high as it is wide. */
async function portraitImage(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 500; canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#47624C'; ctx.fillRect(0, 0, 500, 1000);
    ctx.fillStyle = '#E5A85E'; ctx.fillRect(100, 150, 300, 700);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(data, 'base64');
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
  const tall = await page.request.post(`/api/tutoring/spaces/${space.id}/assets?name=portrait.png`, { headers: { ...CSRF, 'content-type': 'image/png' }, data: await portraitImage(page) });
  expect(tall.status()).toBe(201);
  const { asset: portrait } = await tall.json();
  const picture = (place: 'left' | 'right' | 'bottom', size?: number) => ({ type: 'image' as const, assetId: asset.id, url: `/api/assets/${asset.id}`, alt: 'Geometric composition', place, ...(size ? { size } : {}) });
  const footer = 'LYCÉE JEAN MOULIN · FRANÇAIS A2 · LEÇON 4 · LES TRANSPORTS EN COMMUN · RÉVISER LE PASSÉ COMPOSÉ AVANT LA SÉANCE';
  const paper = defaultDeckDesign('paper');
  const content: Outline = {
    version: 1, meta: { title: 'Slide fitting' },
    design: { ...paper, aspectRatio: '16:9', masters: [...paper.masters, { id: 'tight', name: 'Tight', safeArea: 3, decoration: 'none', footer }] },
    interactions: [
      { id: 'many', type: 'choice', prompt: 'Which month comes next?', options: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, label: `Month ${i + 1}` })) },
      { id: 'bank', type: 'fill-the-gaps', prompt: 'The cat sat on the {{a}}.', display: 'bank', gaps: [{ id: 'a', answers: ['mat'] }], bank: Array.from({ length: 24 }, (_, i) => `word${i + 1}`) },
    ],
    steps: [
      { id: 'story', kind: 'statement', title: 'Read the story', body: 'A fox walked to the river to drink and saw the moon in the water. '.repeat(9).trim() },
      { id: 'beside', kind: 'statement', stat: '2,500,000', title: 'Look at the picture', body: 'Describe two things you notice.', media: picture('right') },
      { id: 'below', kind: 'steps', title: 'Work through it', items: ['Read the task', 'Underline the verbs', 'Find the subject', 'Write one sentence', 'Check the tense', 'Read it aloud'], media: picture('bottom', 30) },
      { id: 'two', kind: 'cards', title: 'Two examples', items: [{ text: 'She has lived here since 2019.' }, { text: 'They have finished the book.' }] },
      { id: 'twelve', kind: 'steps', title: 'Twelve steps', items: Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`) },
      { id: 'html', kind: 'blank', elements: [{ id: 'fixed', type: 'html', html: '<div style="position:fixed;inset:0;background:#c33;color:#fff">Fixed layer</div>', box: { x: 40, y: 40, w: 20, h: 20 } }] },
      { id: 'poll', kind: 'interaction', interactionId: 'many' },
      { id: 'gaps', kind: 'interaction', interactionId: 'bank' },
      { id: 'portrait', kind: 'cards', layout: 'split', title: 'Three places', items: [{ text: 'The station' }, { text: 'The market' }, { text: 'The bakery' }], media: { type: 'image', assetId: portrait.id, url: `/api/assets/${portrait.id}`, alt: 'A tall picture' } },
      { id: 'left', kind: 'steps', layout: 'split', title: 'Order the steps', items: ['Buy a ticket', 'Find the platform', 'Board the train'], media: picture('left', 30) },
      { id: 'tasks', kind: 'activity', title: 'Plan the trip', instructions: ['Choose a city you would like to visit next summer', 'Find two ways to get there and compare the prices', 'Decide where to stay for three nights near the centre', 'List three places you want to see during the visit', 'Write a short message to invite a friend to come along', 'Present your plan to your partner in two minutes'] },
      { id: 'caption', kind: 'media', title: 'The old station', media: { type: 'image', assetId: asset.id, url: `/api/assets/${asset.id}`, alt: 'Geometric composition', caption: 'The station opened in 1900 and still serves trains to the south of the country every day. '.repeat(11).trim() } },
      { id: 'word', kind: 'term', layout: 'split', term: 'la boulangerie', meaning: 'the bakery', example: 'Je vais à la boulangerie.' },
      { id: 'reveal', kind: 'cards', title: 'One at a time', items: [{ text: 'First' }, { text: 'Second' }, { text: 'Third' }, { text: 'Fourth' }], reveal: [['header'], ['cell-0'], ['cell-1'], ['cell-2'], ['cell-3']] },
      { id: 'list', kind: 'steps', layout: 'split', title: 'Step by step', items: ['Listen', 'Repeat', 'Write'], reveal: [['header'], ['cell-0'], ['cell-1'], ['cell-2']] },
      { id: 'listen', kind: 'activity', layout: 'split', title: 'Hören Sie das Gespräch im Hotel und notieren Sie die Antworten', instructions: ['Hören Sie das Gespräch zwischen dem Gast und der Rezeption einmal ganz.', 'Notieren Sie, wann das Frühstück beginnt und wo der Parkplatz ist.', 'Vergleichen Sie Ihre Notizen mit Ihrem Partner und ergänzen Sie sie.', 'Spielen Sie das Gespräch zu zweit nach und tauschen Sie die Rollen.'], media: picture('right', 42) },
      { id: 'kit', kind: 'activity', title: 'Bring these', instructions: ['Work in pairs and share the list', 'Check every item before you start', 'Ask if something is missing'], materials: ['Worksheet A', 'Pencil', 'Dictionary', 'Ruler', 'Scissors', 'Glue', 'Map of the city', 'Timetable', 'Coloured pens', 'Calculator', 'Notebook', 'Answer key'] },
      { id: 'footer', kind: 'cards', title: 'Six cards', design: { masterId: 'tight' }, items: Array.from({ length: 6 }, (_, i) => ({ text: `Card ${i + 1}` })) },
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

  // A tall picture on a split cards slide takes the right side at its share,
  // and the heading stays on the slide.
  await open(8, 'Three places');
  const [tallBox] = await boxes(editor, '[data-part="image"]');
  const cards = await boxes(editor, '[data-part^="cell-"]');
  const [placesHeading] = await boxes(editor, '[data-part="header"]');
  expect(tallBox!.x).toBeGreaterThanOrEqual(Math.max(...cards.map((card) => card.x + card.w)) - 0.005);
  expect(Math.abs(tallBox!.w - 0.42 * 0.84)).toBeLessThan(0.005);
  expect(tallBox!.y).toBeGreaterThanOrEqual(0.075);
  expect(tallBox!.y + tallBox!.h).toBeLessThanOrEqual(await slideHeight(editor) - 0.075);
  expect(placesHeading!.y).toBeGreaterThanOrEqual(0.075);
  await editor.screenshot({ path: testInfo.outputPath('portrait-editor.png') });

  // Place left at 30: the picture is on the left and 30% wide.
  await open(9, 'Order the steps');
  const [leftBox] = await boxes(editor, '[data-part="image"]');
  const [firstStep] = await boxes(editor, '[data-part="cell-0"]');
  expect(leftBox!.x + leftBox!.w).toBeLessThanOrEqual(firstStep!.x + 0.005);
  expect(Math.abs(leftBox!.w - 0.3 * 0.84)).toBeLessThan(0.005);
  await editor.screenshot({ path: testInfo.outputPath('left-editor.png') });

  // An activity with no materials and no picture: the instructions take the width and fit.
  await open(10, 'Plan the trip');
  await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
  const [instructions] = await boxes(editor, '.outline-step__bullets');
  expect(instructions!.w).toBeGreaterThan(0.8);
  await editor.screenshot({ path: testInfo.outputPath('tasks-editor.png') });

  // A 1000-character caption stops at three lines and the picture keeps its height.
  await open(11, 'The old station');
  const [captioned] = await boxes(editor, '[data-part="image"]');
  const [caption] = await boxes(editor, '.outline-step__caption');
  expect(captioned!.h).toBeGreaterThan(0.17);
  expect(caption!.h).toBeLessThan(0.115);
  await editor.screenshot({ path: testInfo.outputPath('caption-editor.png') });

  // A headword in a split column is one line, not broken between letters.
  await open(12, 'la boulangerie');
  const [headword] = await boxes(editor, '[data-part="header"]');
  expect(headword!.h).toBeLessThan(0.06);
  await editor.screenshot({ path: testInfo.outputPath('word-editor.png') });

  // An over-full split activity loses the end of its list, never the heading.
  await open(15, 'Hören Sie das Gespräch im Hotel und notieren Sie die Antworten');
  const [listenHeading] = await boxes(editor, '[data-part="header"]');
  expect(listenHeading!.y).toBeGreaterThanOrEqual(0.075);
  await editor.screenshot({ path: testInfo.outputPath('listen-editor.png') });

  // Twelve materials: the list label and the first items stay on the slide.
  await open(16, 'Bring these');
  const [label] = await boxes(editor, '.outline-step__materials .outline-step__meta');
  expect(label!.y).toBeGreaterThanOrEqual(0.075);
  await editor.screenshot({ path: testInfo.outputPath('kit-editor.png') });

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

  await show(8, 'Three places');
  const [tallWall] = await boxes(wall, '[data-part="image"]');
  await wall.screenshot({ path: testInfo.outputPath('portrait-stage.png') });
  expect(Math.abs(tallWall!.x - tallBox!.x), JSON.stringify([tallWall, tallBox])).toBeLessThan(0.002);
  expect(Math.abs(tallWall!.w - tallBox!.w)).toBeLessThan(0.002);

  // Revealing cards one at a time: the first card keeps its box at every stage.
  const reveal = async (stepId: string, shown: number) => {
    await command(session.sessionCode, session.hostToken, { command: 'outline.reveal', stepId, shown });
    await expect(wall.locator('[data-part^="cell-"]')).toHaveCount(shown - 1);
  };
  await show(13, 'One at a time');
  const firstCard: Box[] = [];
  for (const shown of [2, 3, 4, 5]) {
    await reveal('reveal', shown);
    firstCard.push((await boxes(wall, '[data-part="cell-0"]'))[0]!);
  }
  for (const box of firstCard) for (const axis of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(box[axis] - firstCard[0]![axis]), `card/${axis}`).toBeLessThan(0.001);
  await wall.screenshot({ path: testInfo.outputPath('reveal-stage.png') });

  // On split, the first step and the heading do not move as the next steps appear.
  await show(14, 'Step by step');
  const shownItems: Box[][] = [];
  for (const shown of [2, 3, 4]) {
    await reveal('list', shown);
    shownItems.push(await boxes(wall, '[data-part="header"], [data-part="cell-0"]'));
  }
  for (const [header, item] of shownItems) {
    expect(Math.abs(header!.y - shownItems[0]![0]!.y), 'heading y').toBeLessThan(0.001);
    expect(Math.abs(item!.y - shownItems[0]![1]!.y), 'step y').toBeLessThan(0.001);
  }

  // A two-line footer in a 3% margin: the cards end above it.
  await show(17, 'Six cards');
  const footerBox = (await boxes(wall, '.slide-surface__footer'))[0]!;
  expect(footerBox.h, 'the footer wraps to two lines').toBeGreaterThan(0.03);
  const sixCards = await boxes(wall, '[data-part^="cell-"]');
  expect(sixCards).toHaveLength(6);
  for (const card of sixCards) expect(card.y + card.h).toBeLessThanOrEqual(footerBox.y);
  await wall.screenshot({ path: testInfo.outputPath('footer-stage.png') });
  await stage.close();
});
