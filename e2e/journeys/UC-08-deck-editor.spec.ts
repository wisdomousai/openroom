/**
 * UC-08 — Deck editor: write the deck, then show it.
 *
 * One tutor, one deck, one screen: insert a question from the ribbon,
 * change how it is arranged, retype the prompt on the slide itself, give its
 * parts an order, play that order, hang a breakout off a line, and leave. The
 * journey is about the three promises the deck editor makes:
 *
 *   1. **The canvas is the document.** A layout thumb changes the real layout
 *      class the projector uses; typing on the slide edits the plan file.
 *   2. **The draft is honest.** The status line says "Saved" only after the
 *      server acknowledged it, and a reload still finds the work.
 *
 * Present is checked cheaply at the end: it opens, and Esc closes it.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { waitForWorker } from '../fixtures/session';

const BASE = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CSRF = { 'x-openroom-csrf': '1', 'content-type': 'application/json' };

async function signIn(page: Page): Promise<APIRequestContext> {
  const api = page.request;
  const res = await api.post(`${BASE}/api/auth/demo/login`, {
    headers: CSRF,
    data: { username: 'alice', password: 'demo' },
  });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);

  // `or_session` is minted Secure; a dev worker on plain http never gets it
  // back. Re-add the same cookie without the flag (see UC-06).
  const context = page.context();
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  return api;
}

/**
 * A deck with enough shape to be worth editing: a title, a picture, an
 * activity and a debrief. Seeded through the same public API the CLI writes.
 */
function seedOutline(title: string): unknown {
  return {
    version: 1,
    meta: { title, subject: 'French', level: 'B1' },
    steps: [
      { id: 'welcome', kind: 'title', title, body: 'Today: talking about last weekend.' },
      {
        id: 'photo',
        kind: 'media',
        title: 'Le week-end dernier',
        layout: 'split',
        media: {
          type: 'image',
          url: 'https://placehold.co/1200x800/png',
          alt: 'A photograph of a market on a Saturday morning.',
        },
      },
      {
        id: 'practise',
        kind: 'activity',
        title: 'Tell your partner',
        instructions: ['Pairs.', 'Six sentences each.', 'Past tense only.'],
        materials: ['One prompt card per pair'],
        durationSec: 480,
      },
      {
        id: 'review',
        kind: 'debrief',
        title: 'What we noticed',
        prompts: ['Which verb took être?', 'What still feels shaky?'],
      },
    ],
    // The outline contract requires at least one interaction to be *defined*,
    // even before a block references it (see `removeStep`, which keeps the last
    // one for the same reason). This one is authored ahead of its block.
    interactions: [
      {
        id: 'warm-up',
        type: 'choice',
        prompt: 'How was your weekend?',
        options: [
          { id: 'good', label: 'Bien' },
          { id: 'quiet', label: 'Tranquille' },
        ],
      },
    ],
  };
}

interface Seed {
  deckId: string;
  spaceId: string;
  title: string;
}

async function seedDesign(api: APIRequestContext): Promise<Seed> {
  const stamp = Date.now();


  const contextRes = await api.post(`${BASE}/api/tutoring/contexts`, {
    headers: CSRF,
    // Pinned to the space, because a deck is filed in its context's space —
    // `spaceId` on the deck create only takes effect through the context.
    data: {
      displayName: `Léa ${stamp}`,
      kind: 'person',
      context: { language: 'fr', level: 'B1', goals: ['speaking'] },
    },
  });
  expect(contextRes.status()).toBe(201);
  const { context } = await contextRes.json();
  const contextId: string = context.id;
  const spaceId: string = context.spaceId;

  const title = `Deck editor journey ${stamp}`;
  const deckRes = await api.post(`${BASE}/api/decks`, {
    headers: CSRF,
    data: { title, contextId, spaceId, shape: 'tutoring', outline: seedOutline(title) },
  });
  expect(deckRes.status()).toBe(201);
  const deckId: string = (await deckRes.json()).deck.id;

  return { deckId, spaceId, title };
}

/** The layout class the shared renderer put on the slide in the canvas. */
async function canvasLayout(page: Page): Promise<string> {
  const classes = await page.locator('.slide-canvas__frame .outline-step').first().getAttribute('class');
  return /outline-step--layout-([a-z]+)/.exec(classes ?? '')?.[1] ?? '';
}

test.beforeAll(async () => {
  await waitForWorker();
});

test.describe.configure({ mode: 'serial' });

test.describe('UC-08 deck editor', () => {
  test('insert → layout → type on the slide → reveal → breakout → draft persists', async ({
    page,
  }) => {
    const api = await signIn(page);
    const seed = await seedDesign(api);

    await page.goto(`${BASE}/host/#/decks/${seed.deckId}/edit`);

    // The deck editor is full-bleed: it hangs off the root route, not the
    // workspace shell, so there is no workspace rail beside the deck.
    await expect(page.locator('[data-deck-title]')).toHaveText(seed.title);
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);

    const slides = page.getByRole('list', { name: 'Slides' });
    await expect(slides.getByRole('button')).toHaveCount(4);

    // 1. Insert a question from the ribbon. It lands after the selected slide
    //    and takes the selection — the canvas is already showing it.
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.getByRole('button', { name: 'Question', exact: true }).click();
    const question = page.getByRole('dialog');
    await question.getByLabel('Question', { exact: true }).fill('How was your weekend?');
    await question.getByLabel('Option 1', { exact: true }).fill('Bien');
    await question.getByLabel('Option 2', { exact: true }).fill('Tranquille');
    await question.getByLabel('Option 3', { exact: true }).fill('Fatigant');
    await question.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(slides.getByRole('button')).toHaveCount(5);

    const canvas = page.locator('.slide-canvas__frame');
    await expect(canvas.locator('[data-part="header"]')).toHaveText('How was your weekend?');
    await expect(canvas.locator('[data-part="option-2"]')).toHaveText('Fatigant');
    expect(await canvasLayout(page)).toBe('poll');

    // 2. Switch its arrangement from the properties column. The thumbnail is a
    //    picture of a real layout: the class on the slide is the proof.
    await page.getByRole('button', { name: /^(✓ )?Split$/ }).click();
    await expect
      .poll(async () => canvasLayout(page), { message: 'the canvas takes the chosen layout' })
      .toBe('split');
    // The words survived the move — that is the trade the panel promises.
    await expect(canvas.locator('[data-part="option-2"]')).toHaveText('Fatigant');

    // Grow and shrink the answers on the slide. Three is a starter, not a cap.
    await canvas.getByRole('button', { name: 'Add option' }).click();
    await expect(canvas.locator('[data-part="option-3"]')).toHaveAttribute('data-empty', 'true');
    await canvas.locator('[data-part="option-3"]').click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(canvas.locator('[data-part="option-3"]')).toHaveCount(0);

    // 3. Retype the prompt on the slide itself. Blur commits; the slide list
    //    row and the plan file are the same document, so both follow.
    const prompt = 'Quel auxiliaire ?';
    const header = canvas.locator('[data-part="header"]');
    await header.click({ clickCount: 3 });
    await page.keyboard.type(prompt);
    await page.keyboard.press('Enter'); // Enter blurs, and blur is the commit.
    await expect(header).toHaveText(prompt);
    await expect(slides.getByRole('button', { name: new RegExp(prompt) })).toBeVisible();

    // 4. Give the parts an order, then play it. One at a time makes four
    //    steps: the prompt, then each option.
    await page.getByRole('tab', { name: 'Reveal' }).click();
    // The properties column offers the same choice; this is the ribbon's.
    const ribbon = page.getByRole('tabpanel');
    await ribbon.getByRole('radio', { name: 'One at a time' }).click();
    await expect(ribbon.getByText('Step 4 of 4')).toBeVisible();

    await ribbon.getByRole('button', { name: 'Play reveal' }).click();
    // A part the play-through has not reached is not on the slide at all.
    await expect(canvas.locator('[data-part="header"]')).toBeVisible();
    await expect(canvas.locator('[data-part="option-0"]')).toHaveCount(0);
    await ribbon.getByRole('button', { name: 'Next step' }).click();
    await expect(canvas.locator('[data-part="option-0"]')).toBeVisible();
    await expect(canvas.locator('[data-part="option-1"]')).toHaveCount(0);
    await ribbon.getByRole('button', { name: 'Show all' }).click();
    await expect(canvas.locator('[data-part="option-2"]')).toBeVisible();

    // 5. Hang a breakout off the prompt. Adding one opens it, because that is
    //    the slide you just decided to write.
    await header.click();
    await page.getByRole('button', { name: 'Add breakout slide' }).click();
    await expect(page.getByText(/^Breakout of/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to main slide' }).click();
    // The reveal badge is drawn inside the part, so match the authored words
    // at the end of it — the same thing `partText` strips before committing.
    await expect(header).toHaveText(/Quel auxiliaire \?$/);

    //    …and it is reachable again from the part it hangs off.
    await header.click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to main slide' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to main slide' }).click();

    // 6. The draft is honest: "Saved" appears only once the server said so.
    const status = page.locator('[data-or-draft-status]');
    await expect(status).toHaveAttribute('data-or-draft-status', 'saved', { timeout: 20_000 });

    // A reload finds the work: that is what the draft is for.
    await page.reload();
    await expect(page.locator('.slide-canvas__frame')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Slides' }).getByRole('button')).toHaveCount(6);
    await page
      .getByRole('list', { name: 'Slides' })
      .getByRole('button', { name: new RegExp(prompt) })
      .click();
    await expect(page.locator('.slide-canvas__frame [data-part="header"]')).toHaveText(
      /Quel auxiliaire \?$/,
    );
    expect(await canvasLayout(page)).toBe('split');

    // Present opens the shared presenter at the edited slide; returning keeps
    // that slide selected in the editor.
    await page.getByRole('tab', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Start from here', exact: true }).click();
    const presenter = page.getByRole('dialog', { name: 'Presenter', exact: true });
    await expect(presenter.locator('.stage-mirror [data-part="header"]')).toHaveText(prompt);
    await presenter.getByRole('button', { name: 'Edit deck', exact: true }).click();
    await expect(presenter).toHaveCount(0);
    await expect(page.locator('.slide-canvas__frame [data-part="header"]')).toHaveText(/Quel auxiliaire \?$/);
  });
});
