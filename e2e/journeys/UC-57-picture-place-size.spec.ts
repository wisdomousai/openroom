/**
 * UC-57 — A picture takes the place and size the author gave it, within the
 * limits the schema accepts, and values outside those limits are refused.
 * Contract: docs/journeys/UC-57-picture-place-size.md
 */
import { expect, test } from '@playwright/test';
import { stageUrl, waitForWorker } from '../fixtures/session';
import { goto, liveSession, measureSlide, pictureUrl, servePictures, type Box } from '../fixtures/slide-geometry';
import { DECK_ASPECT_RATIOS, defaultDeckDesign } from '../../packages/schema/src/deck-design';
import { MEDIA_SIZE_DEFAULT, SPLIT_MEDIA_SIZE_MAX, type Outline, type OutlineMediaPlace, type OutlineStep } from '../../packages/schema/src/outline-types';

test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

const SAFE = 0.08;
const SHAPES = { portrait: [600, 1000], square: [800, 800], landscape: [1600, 900] } as const;
type Shape = keyof typeof SHAPES;
const picture = (shape: Shape, place?: OutlineMediaPlace, size?: number) => ({
  type: 'image' as const, url: pictureUrl(...SHAPES[shape]), alt: `A ${shape} picture`,
  ...(place ? { place } : {}), ...(size === undefined ? {} : { size }),
});

interface Case { step: OutlineStep; drawn: 'split' | 'stacked' | 'media'; place: 'left' | 'right' | 'top' | 'bottom' | 'fill'; size: number }
const cases: Case[] = [];
for (const shape of Object.keys(SHAPES) as Shape[]) {
  // Beside the words: left and right draw a statement as split; size is the column's share of the width.
  for (const place of ['left', 'right'] as const) {
    for (const size of [20, undefined, SPLIT_MEDIA_SIZE_MAX]) {
      const title = `${shape} ${place} ${String(size ?? 'default')}`;
      cases.push({ drawn: 'split', place, size: size ?? MEDIA_SIZE_DEFAULT, step: { id: title.replaceAll(' ', '-'), kind: 'statement', title, body: 'Describe two things you notice.', media: picture(shape, place, size) } });
    }
  }
  // Top and bottom on split draw as right.
  cases.push({ drawn: 'split', place: 'right', size: 30, step: { id: `${shape}-split-top`, kind: 'statement', layout: 'split', title: `${shape} split top`, body: 'Describe two things you notice.', media: picture(shape, 'top', 30) } });
  // Above or below the words: size is the most height the picture takes.
  for (const place of ['top', 'bottom'] as const) {
    for (const size of [20, 60, 100]) {
      const title = `${shape} ${place} ${String(size)}`;
      cases.push({ drawn: 'stacked', place, size, step: { id: title.replaceAll(' ', '-'), kind: 'statement', title, body: 'Describe two things you notice.', media: picture(shape, place, size) } });
    }
  }
  // Fill, on the media layout only: the picture takes its whole area.
  cases.push({ drawn: 'media', place: 'fill', size: 100, step: { id: `${shape}-fill`, kind: 'media', title: `${shape} fill`, media: picture(shape, 'fill') } });
}

const near = (actual: number, expected: number, label: string) => expect.soft(Math.abs(actual - expected), `${label}: ${actual.toFixed(4)} vs ${expected.toFixed(4)}`).toBeLessThan(0.005);

for (const ratio of DECK_ASPECT_RATIOS) {
  test(`${ratio}: portrait, square and landscape pictures take their place and size`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const outline: Outline = { version: 1, meta: { title: `Pictures ${ratio}` }, interactions: [], design: { ...defaultDeckDesign('clean'), aspectRatio: ratio }, steps: cases.map((item) => item.step) };
    const session = await liveSession(outline);
    const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    await servePictures(stage);
    await stage.goto(stageUrl(session));
    const wall = stage.locator('.stage__main .slide-surface');
    for (const { step, drawn, place, size } of cases) {
      const title = (step as { title: string }).title;
      await goto(session, step.id);
      await expect(wall.locator('[data-part="header"]')).toHaveText(title);
      const { height, parts, cut } = await measureSlide(wall, SAFE * 100);
      const image = parts.image!;
      const words = [parts.header!, parts.body].filter((box): box is Box => box !== undefined);
      const content = { top: SAFE, bottom: height - SAFE, width: 1 - 2 * SAFE };
      expect.soft(cut, `${step.id}: nothing is cut`).toEqual([]);
      if (drawn === 'split') {
        await expect.soft(wall.locator('.outline-step'), step.id).toHaveClass(/outline-step--layout-split/);
        near(image.w, (size / 100) * content.width, `${step.id}: column width`);
        near(image.h, content.bottom - content.top, `${step.id}: fills the column height`);
        for (const word of words) {
          if (place === 'left') expect.soft(image.x + image.w, `${step.id}: picture left of the words`).toBeLessThanOrEqual(word.x + 0.005);
          else expect.soft(image.x, `${step.id}: picture right of the words`).toBeGreaterThanOrEqual(word.x + word.w - 0.005);
        }
      } else if (drawn === 'stacked') {
        await expect.soft(wall.locator('.outline-step'), step.id).not.toHaveClass(/outline-step--layout-split/);
        const most = (size / 100) * (content.bottom - content.top);
        expect.soft(image.h, `${step.id}: at most its size tall`).toBeLessThanOrEqual(most + 0.005);
        if (size === 20) near(image.h, most, `${step.id}: takes its size when there is room`);
        for (const word of words) {
          if (place === 'top') expect.soft(image.y + image.h, `${step.id}: picture above the words`).toBeLessThanOrEqual(word.y + 0.005);
          else expect.soft(image.y, `${step.id}: picture below the words`).toBeGreaterThanOrEqual(word.y + word.h - 0.005);
        }
      } else {
        // The picture area is the box the picture sits in; a filled still covers all of it.
        const area = await wall.locator('[data-part="image"]').evaluate((img) => {
          const frame = img.closest('.slide-surface')!.getBoundingClientRect();
          const box = img.parentElement!.getBoundingClientRect();
          return { x: (box.left - frame.left) / frame.width, y: (box.top - frame.top) / frame.width, w: box.width / frame.width, h: box.height / frame.width };
        });
        for (const axis of ['x', 'y', 'w', 'h'] as const) near(image[axis], area[axis], `${step.id}: fills its area (${axis})`);
      }
      if (drawn !== 'media') {
        expect.soft(image.y, `${step.id}: top margin`).toBeGreaterThanOrEqual(content.top - 0.003);
        expect.soft(image.y + image.h, `${step.id}: bottom margin`).toBeLessThanOrEqual(content.bottom + 0.003);
      }
      if (step.id === 'portrait-left-60' || step.id === 'landscape-bottom-60') await wall.screenshot({ path: testInfo.outputPath(`${step.id}.png`) });
    }
    await stage.close();
  });
}

test('a picture size or place the drawn layout cannot hold is refused', async ({ request }) => {
  const start = async (step: OutlineStep) => {
    const response = await request.post('/api/sessions', {
      headers: { 'x-openroom-admin': process.env.OPENROOM_ADMIN_KEY ?? 'dev-admin' },
      data: { outline: { version: 1, meta: { title: 'Refused' }, interactions: [], steps: [step] } },
    });
    return { status: response.status(), text: await response.text() };
  };
  const statement = (media: ReturnType<typeof picture>, layout?: 'split'): OutlineStep => ({ id: 's', kind: 'statement', title: 'Look', body: 'Describe it.', media, ...(layout ? { layout } : {}) });
  const cases: [string, OutlineStep, RegExp][] = [
    ['size 61 on split', statement(picture('square', 'right', SPLIT_MEDIA_SIZE_MAX + 1), 'split'), /E_MEDIA_LAYOUT[\s\S]*\/steps\/0\/media\/size/],
    ['size 61 placed left, which draws as split', statement(picture('square', 'left', SPLIT_MEDIA_SIZE_MAX + 1)), /E_MEDIA_LAYOUT[\s\S]*\/steps\/0\/media\/size/],
    ['fill outside the media layout', statement(picture('square', 'fill')), /E_MEDIA_LAYOUT[\s\S]*\/steps\/0\/media\/place/],
    ['size 19', statement(picture('square', 'bottom', 19)), /\/steps\/0\/media\/size/],
    ['size 101', statement(picture('square', 'bottom', 101)), /\/steps\/0\/media\/size/],
  ];
  for (const [label, step, error] of cases) {
    const { status, text } = await start(step);
    expect.soft(status, label).toBe(422);
    expect.soft(text, label).toMatch(error);
  }
  // The largest accepted sizes still start a session.
  expect((await start(statement(picture('square', 'right', SPLIT_MEDIA_SIZE_MAX), 'split'))).status).toBe(201);
  expect((await start(statement(picture('square', 'bottom', 100)))).status).toBe(201);
});
