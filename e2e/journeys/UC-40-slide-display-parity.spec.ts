import { expect, type Locator } from '@playwright/test';
import { test } from '../fixtures/learner-browser';
import { joinInBrowser, stageUrl, waitForWorker } from '../fixtures/session';
import { designImage } from '../fixtures/design-images';
import { defaultDeckDesign, DECK_ASPECT_RATIOS, deckAspectRatio } from '../../packages/schema/src/deck-design';
import { SLIDE_TEMPLATES } from '../../packages/schema/src/slide-templates';
import type { Outline } from '../../packages/schema/src/outline-types';

const CSRF = { 'x-openroom-csrf': '1' };
test.beforeAll(async () => { await waitForWorker(); });
test.use({ trace: 'retain-on-failure' });

async function geometry(surface: Locator) {
  for (const picture of await surface.locator('img').all()) {
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  return surface.evaluate(async (root) => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const frame = root.getBoundingClientRect();
    return {
      ratio: frame.width / frame.height,
      parts: [...root.querySelectorAll<HTMLElement>('[data-part]')].map((part) => {
        const box = part.getBoundingClientRect();
        return { key: part.dataset.part!, text: part.textContent?.trim() ?? '',
          x: (box.left - frame.left) / frame.width, y: (box.top - frame.top) / frame.width,
          w: box.width / frame.width, h: box.height / frame.width,
          font: parseFloat(getComputedStyle(part).fontSize) / frame.width,
        };
      }),
    };
  });
}

for (const ratio of DECK_ASPECT_RATIOS) {
  test(`${ratio}: editor, control, fullscreen and mobile retain the same composition and margins`, async ({ page, browser, learnerBrowser }, testInfo) => {
    test.setTimeout(120_000);
    await page.request.post('/api/auth/demo/login', { headers: CSRF, data: { username: 'alice', password: 'demo' } });
    const spaceResponse = await page.request.post('/api/my/spaces', { headers: CSRF, data: { name: `Display parity ${ratio}`, experience: 'classroom' } });
    expect(spaceResponse.status()).toBe(201);
    const space = await spaceResponse.json();
    const uploaded = await page.request.post(`/api/tutoring/spaces/${space.id}/assets?name=composition.png`, { headers: { ...CSRF, 'content-type': 'image/png' }, data: await designImage(page) });
    expect(uploaded.status()).toBe(201);
    const { asset } = await uploaded.json();
    const content: Outline = {
      version: 1, meta: { title: `Display parity ${ratio}` },
      design: { ...defaultDeckDesign('paper'), aspectRatio: ratio }, interactions: [],
      steps: ['title', 'objectives', 'text-image', 'cards', 'reading', 'group-task'].map((id) => ({ ...structuredClone(SLIDE_TEMPLATES.find((t) => t.id === id)!.step), id })),
    };
    content.steps.push(
      { id: 'split', kind: 'statement', layout: 'split', title: 'Explain the choice', body: 'Give one reason and a concrete example.' },
      { id: 'media', kind: 'media', title: 'Look closely', media: { type: 'image', assetId: asset.id, url: `/api/assets/${asset.id}`, alt: 'Geometric composition' } },
    );
    const created = await page.request.post('/api/decks', { headers: CSRF, data: { content, spaceId: space.id } });
    expect(created.status(), await created.text()).toBe(201);
    const { deck } = await created.json();
    await page.goto(`/host/#/decks/${deck.id}/edit`);
    const editor = page.locator('.slide-canvas__frame .slide-surface');
    const baseline = [];
    for (const [index, step] of content.steps.entries()) {
      await page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button').nth(index).click();
      await expect(page.locator('[data-slide-overflow]')).toHaveCount(0);
      if (step.id === 'media') await expect(editor.getByRole('img', { name: 'Geometric composition' })).toBeVisible();
      const measured = await geometry(editor);
      expect(measured.ratio).toBeCloseTo(deckAspectRatio(ratio), 3);
      expect(measured.parts.length).toBeGreaterThan(0);
      for (const part of measured.parts) {
        // Freeform objects are authored in percent coordinates; starter objects
        // and structured content should both leave the master's 8% width inset.
        expect.soft(part.x, `${step.id}/${part.key}: left margin`).toBeGreaterThanOrEqual(0.078);
        expect.soft(part.y, `${step.id}/${part.key}: top margin`).toBeGreaterThanOrEqual(0.078);
        expect.soft(part.x + part.w, `${step.id}/${part.key}: right margin`).toBeLessThanOrEqual(0.922);
        expect.soft(part.y + part.h, `${step.id}/${part.key}: bottom margin`).toBeLessThanOrEqual(1 / deckAspectRatio(ratio) - 0.078);
      }
      baseline.push(measured);
    }
    await page.getByRole('list', { name: 'Slides', exact: true }).getByRole('button').first().click();
    const launched = page.waitForResponse((response) => /\/sessions\/[^/]+\/launch$/.test(response.url()) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    const session = await (await launched).json();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    const control = presenter.locator('.stage-mirror .slide-surface');
    const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    await stage.goto(stageUrl(session));
    const wall = stage.locator('.stage__main .slide-surface');
    await expect(wall).toBeVisible();
    await wall.click();
    await stage.locator('body').evaluate((body) => body.requestFullscreen());
    await expect.poll(() => stage.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    const learner = await learnerBrowser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await joinInBrowser(learner, session.code);
    await expect(learner.getByRole('button', { name: 'Slide', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const mobile = learner.locator('.learner-slide__plate .slide-surface');
    for (const [index, step] of content.steps.entries()) {
      await presenter.getByRole('tablist', { name: 'Slides', exact: true }).getByRole('tab').nth(index).click();
      const expected = baseline[index]!;
      for (const [name, surface] of [['control', control], ['fullscreen', wall], ['mobile', mobile]] as const) {
        const first = expected.parts[0]!;
        await expect(surface.locator(`[data-part="${first.key}"]`)).toHaveText(first.text);
        if (step.id === 'media') await expect(surface.getByRole('img', { name: 'Geometric composition' })).toBeVisible();
        const actual = await geometry(surface);
        expect(actual.ratio, `${step.id}/${name}: ratio`).toBeCloseTo(expected.ratio, 3);
        expect(actual.parts.map(({ key, text }) => ({ key, text })), `${step.id}/${name}: content`).toEqual(expected.parts.map(({ key, text }) => ({ key, text })));
        for (const [partIndex, part] of actual.parts.entries()) {
          for (const axis of ['x', 'y', 'w', 'h', 'font'] as const) {
            expect.soft(Math.abs(part[axis] - expected.parts[partIndex]![axis]), `${step.id}/${name}/${part.key}/${axis}`).toBeLessThan(0.009);
          }
        }
        if (['title', 'cards', 'group-task', 'media'].includes(step.id)) await surface.screenshot({ path: testInfo.outputPath(`${step.id}-${name}.png`) });
      }
    }
    await learner.close();
    await stage.close();
  });
}
