/**
 * UC-44 — Participant phone states.
 *
 * A pause keeps a typed draft; accent keys write at the caret and keep the
 * field focused; typed gaps sit in the sentence with numbered labels and
 * practice hints; a ranking never starts in the authored order; Leave asks
 * first; the ended view drops Leave and the handle notice; a refused seat says
 * the session is no longer open; join failures read as plain sentences; a
 * personal link opened before the start waits and enters on its own.
 *
 * The phone page scrolls by finger at short, narrow and landscape sizes, so
 * Send, the answered state and the results stay reachable; list-heavy slides
 * open in Reading below 640 px and the learner's choice survives a question;
 * the individual listening player sits under the slide with a learner error;
 * a lost connection names the unsent answer and the banner clears once the
 * phone is back;
 * a looked-up word loses its punctuation, the sheet keeps Close in view, takes
 * focus, closes on Escape and when the step changes.
 */
import { test, expect, devices, type APIRequestContext, type Page } from '@playwright/test';

import {
  command,
  createSession,
  joinInBrowser,
  participantUrl,
  waitForWorker,
  type CreatedSession,
} from '../fixtures/session';

const BASE = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CSRF = { 'x-openroom-csrf': '1', 'content-type': 'application/json' };
const PHONE = { ...devices['iPhone 13'], locale: 'en-GB', reducedMotion: 'reduce' as const };

const RANKING = ['Sea', 'Lakes', 'Mountains', 'Snow'];

const OUTLINE = {
  version: 1,
  meta: { title: 'Phone states', subject: 'French', level: 'A2' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Bonjour' },
    { id: 's-text', kind: 'interaction', interactionId: 'q-text' },
    { id: 's-gaps', kind: 'interaction', interactionId: 'q-gaps' },
    { id: 's-rank', kind: 'interaction', interactionId: 'q-rank' },
  ],
  interactions: [
    { id: 'q-text', type: 'text', prompt: 'Écrivez une phrase.', match: { locale: 'fr' } },
    {
      id: 'q-gaps',
      type: 'fill-the-gaps',
      prompt: 'Je {{g1}} au marché, puis je {{g2}} le pain.',
      match: { locale: 'fr' },
      gaps: [
        { id: 'g1', answers: ['suis allé'] },
        { id: 'g2', answers: ['ai acheté'] },
      ],
    },
    {
      id: 'q-rank',
      type: 'ranking',
      prompt: 'Order by height',
      options: RANKING.map((label, index) => ({ id: `r${index + 1}`, label })),
    },
  ],
};

const PHRASES = [
  'Je voudrais réserver une table pour deux personnes, s’il vous plaît.',
  'Est-ce que vous pouvez répéter plus lentement ?',
  'Je ne suis pas sûr de comprendre la question.',
  'Pouvez-vous me montrer le chemin jusqu’à la gare ?',
  'Je cherche une pharmacie qui est ouverte le dimanche.',
  'Nous avons rendez-vous à quinze heures trente.',
  'Il faut changer de train à Lyon pour aller à Grenoble.',
  'Je préfère payer par carte si c’est possible.',
  'Merci beaucoup, vous avez été très gentil.',
];

const CHOICES = Array.from(
  { length: 10 },
  (_, index) => `Réponse ${index + 1} : une phrase assez longue pour passer sur deux lignes au téléphone`,
);

const REACH = {
  version: 1,
  meta: { title: 'Phone reach', subject: 'French', level: 'A2' },
  steps: [
    { id: 'phrases', kind: 'steps', title: 'Phrases utiles', items: PHRASES },
    {
      id: 'listen',
      kind: 'media',
      title: 'Écoutez le rendez-vous',
      media: { type: 'audio', url: '/api/assets/missing-recording', alt: 'Le rendez-vous', listening: { mode: 'individual' } },
    },
    { id: 's-text', kind: 'interaction', interactionId: 'q-text' },
    { id: 's-many', kind: 'interaction', interactionId: 'q-many' },
  ],
  interactions: [
    {
      id: 'q-text',
      type: 'text',
      prompt: 'Où êtes-vous allé ce matin ?',
      correctAnswers: ['Je suis allé au marché'],
      match: { locale: 'fr' },
    },
    {
      id: 'q-many',
      type: 'choice',
      prompt: 'Choisissez la bonne réponse.',
      options: CHOICES.map((label, index) => ({ id: `c${index + 1}`, label })),
    },
  ],
};

const FOUR = [
  'Au bout de la rue, à gauche après la boulangerie',
  'Derrière la mairie, en face du parc',
  'À côté de la poste, près du pont',
  'Tout droit, puis la deuxième rue à droite',
];

const QUESTIONS = [
  'Est-ce que le train pour Lyon part du quai numéro trois ce soir ?',
  'Faut-il composter le billet avant de monter dans le train ?',
  'Où peut-on acheter un billet quand le guichet est fermé ?',
];

const SHORT = {
  version: 1,
  meta: { title: 'Short phone', subject: 'French', level: 'A2' },
  qna: { enabled: true },
  steps: [
    { id: 'word', kind: 'term', term: 'la gare', meaning: 'the railway station' },
    {
      id: 'talk',
      kind: 'blank',
      elements: [
        { id: 'head', type: 'text', role: 'heading', text: 'À la gare', box: { x: 6, y: 8, w: 88, h: 14 } },
        { id: 'line', type: 'text', text: 'Demandez le prochain train pour Lyon.', box: { x: 6, y: 30, w: 88, h: 20 } },
      ],
    },
    { id: 'phrases', kind: 'steps', title: 'Phrases utiles', items: PHRASES },
    {
      id: 'listen',
      kind: 'media',
      title: 'Écoutez',
      media: { type: 'audio', url: '/api/assets/missing-recording', alt: '', listening: { mode: 'individual' } },
    },
    { id: 's-text', kind: 'interaction', interactionId: 'q-text' },
    { id: 's-four', kind: 'interaction', interactionId: 'q-four' },
  ],
  interactions: [
    { id: 'q-text', type: 'text', prompt: 'Où êtes-vous allé ce matin ?', match: { locale: 'fr' } },
    { id: 'q-four', type: 'choice', prompt: 'Où est la gare ?', options: FOUR.map((label, index) => ({ id: `f${index + 1}`, label })) },
  ],
};

async function fontSize(target: ReturnType<Page['locator']>): Promise<number> {
  return target.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

async function minSide(target: ReturnType<Page['locator']>): Promise<number> {
  const box = (await target.boundingBox())!;
  return Math.min(box.width, box.height);
}

/**
 * Scroll the way a thumb does, with the wheel at the middle of the screen, until
 * the target sits inside the viewport. A programmatic scroll would also move an
 * overflow-hidden box, which is exactly the bug this guards against.
 */
async function reachByScrolling(page: Page, target: ReturnType<Page['locator']>): Promise<boolean> {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let step = 0; step < 40; step++) {
    const box = await target.boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= viewport.height) return true;
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(40);
  }
  return false;
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.page__body')?.scrollTo(0, 0);
  });
}

test.beforeAll(async () => {
  await waitForWorker();
});

async function openStep(session: CreatedSession, interactionId: string): Promise<void> {
  await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId });
}

async function activeId(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.getAttribute('id') ?? document.activeElement?.getAttribute('aria-label') ?? '');
}

test.describe('UC-44 participant phone states', () => {
  test('drafts, accent keys, typed gaps, ranking start, Leave and the end of a session', async ({ browser }) => {
    const session = await createSession(OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await openStep(session, 'q-text');

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    await joinInBrowser(phone, session.code);

    // Accent key at the caret, focus stays in the field.
    const answer = phone.getByRole('textbox', { name: 'Answer', exact: true });
    await answer.fill('Je suis all au parc');
    await answer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(11, 11));
    await phone.getByRole('group', { name: 'Accents' }).getByRole('button', { name: 'é', exact: true }).click();
    await expect(answer).toHaveValue('Je suis allé au parc');
    expect(await activeId(phone)).toBe('text-answer');
    await expect(answer).toHaveAttribute('lang', 'fr');
    await expect(answer).toHaveAttribute('autocorrect', 'off');
    await expect(answer).toHaveAttribute('spellcheck', 'false');

    // A pause keeps the draft; resuming hands it back.
    await command(session.sessionCode, session.hostToken, { command: 'session.freeze' });
    await expect(phone.getByText('Answers paused.', { exact: true })).toBeVisible();
    await expect(answer).toBeDisabled();
    await expect(answer).toHaveValue('Je suis allé au parc');
    await command(session.sessionCode, session.hostToken, { command: 'session.unfreeze' });
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue('Je suis allé au parc');
    await phone.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();

    // Typed gaps: numbered, inline, practice hints, accent keys for the focused gap.
    await openStep(session, 'q-gaps');
    const gap1 = phone.getByRole('textbox', { name: 'Gap 1', exact: true });
    const gap2 = phone.getByRole('textbox', { name: 'Gap 2', exact: true });
    await expect(gap1).toBeVisible();
    for (const gap of [gap1, gap2]) {
      await expect(gap).toHaveAttribute('lang', 'fr');
      await expect(gap).toHaveAttribute('autocorrect', 'off');
      await expect(gap).toHaveAttribute('autocapitalize', 'off');
      const box = await gap.boundingBox();
      expect(box!.width).toBeLessThan(200);
    }
    await gap1.fill('suis all');
    await phone.getByRole('group', { name: 'Accents' }).getByRole('button', { name: 'é', exact: true }).click();
    await expect(gap1).toHaveValue('suis allé');
    expect(await activeId(phone)).toBe('Gap 1');
    await gap2.fill('ai achet');
    await phone.getByRole('group', { name: 'Accents' }).getByRole('button', { name: 'é', exact: true }).click();
    await expect(gap2).toHaveValue('ai acheté');
    await phone.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();

    // Editing a sent answer survives a pause too (each pause is a new snapshot).
    await phone.getByRole('button', { name: 'Change answer', exact: true }).click();
    await gap2.fill('ai pris');
    await command(session.sessionCode, session.hostToken, { command: 'session.freeze' });
    await expect(gap2).toBeDisabled();
    await command(session.sessionCode, session.hostToken, { command: 'session.unfreeze' });
    await expect(gap2).toBeEnabled();
    await expect(gap2).toHaveValue('ai pris');
    await phone.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();

    // A ranking does not open in the authored order.
    await openStep(session, 'q-rank');
    const items = phone.locator('.ranking__label');
    await expect(items).toHaveCount(RANKING.length);
    expect(await items.allInnerTexts()).not.toEqual(RANKING);

    // Leave asks first, at the 44 px target; Stay keeps the seat.
    const leave = phone.getByRole('button', { name: 'Leave', exact: true });
    expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await leave.click();
    await expect(phone.getByText('Leave this session? You will join as a new participant.', { exact: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Leave session', exact: true })).toHaveCount(0);
    await expect(phone.locator('.ranking__label')).toHaveCount(RANKING.length);

    // The ended view has nothing to leave and no rejoin notice.
    await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    await expect(phone.getByText('Session ended', { exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Leave', exact: true })).toHaveCount(0);
    await expect(phone.getByText(/Use it to rejoin/)).toHaveCount(0);

    // A refused seat is not "offline": the page says so and forgets the seat.
    await phone.evaluate(() => {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i)!;
          if (!key.startsWith('openroom:participant:')) continue;
          const value = JSON.parse(store.getItem(key)!) as { token: string };
          store.setItem(key, JSON.stringify({ ...value, token: `${value.token}x` }));
        }
      }
    });
    await phone.reload();
    await expect(phone.getByText('This session is no longer open', { exact: true })).toBeVisible();
    await expect(phone.getByText(/Offline/)).toHaveCount(0);

    // Join failures are sentences with a next step, never a bare status.
    await phone.getByRole('button', { name: 'Join with a code', exact: true }).click();
    await phone.getByRole('textbox', { name: 'Join code' }).fill('ZZZZZZZZ');
    await phone.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      phone.getByText('This session has ended, or the code is wrong. Check it with your tutor.', { exact: true }),
    ).toBeVisible();
    await expect(phone.getByText(/\(404\)/)).toHaveCount(0);
    await context.close();
  });

  test('the phone page scrolls to Send and results, keeps the view choice and the player', async ({ browser }, testInfo) => {
    const session = await createSession(REACH);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'phrases' });

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    await joinInBrowser(phone, session.code);

    // A list-heavy slide opens in Reading below 640 px; its last line is reachable.
    const reading = phone.getByRole('button', { name: 'Reading', exact: true });
    const slide = phone.getByRole('button', { name: 'Slide', exact: true });
    await expect(reading).toHaveAttribute('aria-pressed', 'true');
    const lastPhrase = phone.getByText(PHRASES.at(-1)!, { exact: true });
    expect(await reachByScrolling(phone, lastPhrase)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('reading-last-line-390.png') });

    // The learner's choice survives a question in between.
    await scrollToTop(phone);
    await slide.click();
    await openStep(session, 'q-text');
    await expect(phone.getByRole('textbox', { name: 'Answer', exact: true })).toBeVisible();
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'phrases' });
    await expect(slide).toHaveAttribute('aria-pressed', 'true');

    // The individual player sits under the slide, at the 44 px target, with a learner error.
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'listen' });
    const player = phone.getByRole('region', { name: 'Your player', exact: true });
    await expect(player).toBeVisible();
    const plate = (await phone.locator('.learner-slide__plate').boundingBox())!;
    expect((await player.boundingBox())!.y).toBeGreaterThanOrEqual(plate.y + plate.height);
    const replay = player.getByRole('button', { name: 'Replay', exact: true });
    expect((await replay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const failed = player.getByRole('alert');
    await expect(failed).toHaveText(/This audio could not be loaded\. Check your connection, then tap Retry loading\./);
    expect(await reachByScrolling(phone, failed)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('listening-player-390.png') });

    // Landscape: the slide keeps its size and the region scrolls to the player.
    await scrollToTop(phone);
    await phone.setViewportSize({ width: 844, height: 390 });
    expect((await phone.locator('.learner-slide__plate').boundingBox())!.height).toBeGreaterThan(100);
    expect(await reachByScrolling(phone, failed)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('listening-player-844x390.png') });

    // A short window (keyboard open): Send, then Change answer, are reachable by finger.
    await scrollToTop(phone);
    await phone.setViewportSize({ width: 390, height: 340 });
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 's-text' });
    await openStep(session, 'q-text');
    const answer = phone.getByRole('textbox', { name: 'Answer', exact: true });
    await answer.fill('Je suis allé au marché');
    const send = phone.getByRole('button', { name: 'Send answer', exact: true });
    expect(await reachByScrolling(phone, send)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('send-390x340.png') });
    await send.click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();
    expect(await reachByScrolling(phone, phone.getByRole('button', { name: 'Change answer', exact: true }))).toBe(true);

    // Landscape: the content region scrolls to the revealed result and the accepted form.
    await scrollToTop(phone);
    await phone.setViewportSize({ width: 844, height: 390 });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: 'q-text' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: 'q-text' });
    const accepted = phone.getByText('Accepted answer:', { exact: false });
    await expect(accepted).toContainText('Je suis allé au marché');
    expect(await reachByScrolling(phone, accepted)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('revealed-844x390.png') });

    // Ten long options at 360x640: the last option is reachable, and a tap sends it.
    await scrollToTop(phone);
    await phone.setViewportSize({ width: 360, height: 640 });
    await openStep(session, 'q-many');
    const lastOption = phone.getByRole('radio', { name: CHOICES.at(-1)!, exact: true });
    expect(await reachByScrolling(phone, lastOption)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('choice-10-360x640.png') });
    await lastOption.click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();

    // A lost connection names the unsent answer. The banner clears once the phone
    // is back; the unsent line stays until the learner sends again.
    const change = phone.getByRole('button', { name: 'Change answer', exact: true });
    expect(await reachByScrolling(phone, change)).toBe(true);
    await change.click();
    await context.setOffline(true);
    const firstOption = phone.getByRole('radio', { name: CHOICES[0]!, exact: true });
    await firstOption.click();
    const unsent = phone.getByText('Your answer was not sent. Try again.', { exact: true });
    await expect(unsent).toBeInViewport();
    await expect(phone.getByText(/Offline — reconnecting/)).toBeVisible();
    await context.setOffline(false);
    await expect(phone.getByText(/Offline|Reconnecting/)).toHaveCount(0, { timeout: 15_000 });
    await expect(unsent).toBeVisible();
    await firstOption.click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();
    await expect(unsent).toHaveCount(0);
    await context.close();
  });

  test('a short or sideways phone reaches Join, Reading, the Q&A list and every option at 44 px', async ({ browser }, testInfo) => {
    const session = await createSession(SHORT);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 340 });
    await phone.goto(participantUrl(session.code));
    const join = phone.getByRole('button', { name: 'Join', exact: true });
    await join.waitFor({ state: 'visible', timeout: 20_000 });
    expect(await reachByScrolling(phone, join)).toBe(true);
    await join.click();

    // Every control around the slide clears the 44 px target.
    const dismiss = phone.getByRole('button', { name: 'Dismiss', exact: true });
    const reading = phone.getByRole('button', { name: 'Reading', exact: true });
    await expect(reading).toBeVisible({ timeout: 20_000 });
    for (const control of [
      dismiss,
      phone.getByRole('button', { name: 'Leave', exact: true }),
      phone.getByRole('tab', { name: 'Now', exact: true }),
      phone.getByRole('tab', { name: /^Q&A/ }),
      phone.getByRole('button', { name: 'Slide', exact: true }),
      reading,
    ]) {
      expect(await minSide(control)).toBeGreaterThanOrEqual(44);
    }
    await dismiss.click();

    // Reading keeps the headword above the meaning, and a heading element above its text.
    await reading.click();
    const plate = phone.locator('.learner-slide__plate');
    expect(await fontSize(plate.getByText('la gare', { exact: true }))).toBeGreaterThan(
      await fontSize(plate.getByText('the railway station', { exact: true })),
    );
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'talk' });
    const heading = plate.getByRole('heading', { name: 'À la gare', exact: true });
    await expect(heading).toBeVisible();
    expect(await fontSize(heading)).toBeGreaterThan(
      await fontSize(plate.getByText('Demandez le prochain train pour Lyon.', { exact: true })),
    );

    // The last Reading line is reachable on the short window.
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'phrases' });
    expect(await reachByScrolling(phone, phone.getByText(PHRASES.at(-1)!, { exact: true }))).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('reading-last-line-390x340.png') });

    // A recording without a label is called Listening, never a file name or nothing.
    await scrollToTop(phone);
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 'listen' });
    await expect(plate.locator('.listening-block__title')).toHaveText('Listening');
    await expect(phone.getByRole('region', { name: 'Your player', exact: true }).locator('audio')).toHaveAttribute('aria-label', 'Listening');

    // Free text on the short window: the field sits on screen under the tabs without a scroll.
    await command(session.sessionCode, session.hostToken, { command: 'outline.goto', stepId: 's-text' });
    await openStep(session, 'q-text');
    await scrollToTop(phone);
    const answer = phone.getByRole('textbox', { name: 'Answer', exact: true });
    await expect(answer).toBeVisible();
    const field = (await answer.boundingBox())!;
    expect(field.y + field.height).toBeLessThanOrEqual(340);
    await phone.screenshot({ path: testInfo.outputPath('text-field-390x340.png') });

    // The Q&A list scrolls to its last question, short and sideways.
    await phone.getByRole('tab', { name: /^Q&A/ }).click();
    for (const question of QUESTIONS) {
      await phone.getByLabel('Ask a question').fill(question);
      const ask = phone.getByRole('button', { name: 'Send question', exact: true });
      expect(await reachByScrolling(phone, ask)).toBe(true);
      await ask.click();
      await expect(phone.locator('.qna__item--own', { hasText: question })).toHaveCount(1);
    }
    for (const size of [{ width: 390, height: 340 }, { width: 844, height: 390 }]) {
      await scrollToTop(phone);
      await phone.setViewportSize(size);
      const last = phone.locator('.qna__item').last();
      expect(await reachByScrolling(phone, last)).toBe(true);
      await phone.screenshot({ path: testInfo.outputPath(`qna-${size.width}x${size.height}.png`) });
    }

    // Four options on a 320x568 phone: the last one is reachable and sends.
    await phone.getByRole('tab', { name: 'Now', exact: true }).click();
    await scrollToTop(phone);
    await phone.setViewportSize({ width: 320, height: 568 });
    await openStep(session, 'q-four');
    const lastOption = phone.getByRole('radio', { name: FOUR.at(-1)!, exact: true });
    expect(await reachByScrolling(phone, lastOption)).toBe(true);
    await phone.screenshot({ path: testInfo.outputPath('choice-4-320x568.png') });
    await lastOption.click();
    await expect(phone.getByText('Answer received', { exact: true })).toBeVisible();
    await context.close();
  });

  test('a looked-up word drops its punctuation; the sheet keeps Close, takes focus and closes', async ({ page, browser }, testInfo) => {
    const api = await signIn(page);
    const seed = await seedIdentifiedLobby(api, LOOKUP);
    await command(seed.sessionCode, seed.hostToken, { command: 'session.start' });

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    const asked: string[] = [];
    await phone.route('**/api/sessions/*/dictionary', async (route) => {
      const word = route.request().postDataJSON().word as string;
      asked.push(word);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: longEntry(word), meaning: `meaning of ${word}` }) });
    });
    await phone.goto(joinUrl(seed.code, seed.linkToken));
    const token = phone.locator('.learner-slide__plate [data-token]', { hasText: 'passé,' });
    await expect(token).toBeVisible({ timeout: 20_000 });

    await token.click();
    const sheet = phone.getByRole('dialog', { name: 'Dictionary: passé', exact: true });
    await expect(sheet.locator('.learner-lookup__meaning')).toHaveText('meaning of passé');
    expect(asked).toEqual(['passé']);
    const close = sheet.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    const closeBox = (await close.boundingBox())!;
    expect(Math.min(closeBox.width, closeBox.height)).toBeGreaterThanOrEqual(44);

    // Close stays in view while the forms table scrolls under it.
    await sheet.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    const sheetBox = (await sheet.boundingBox())!;
    const scrolledClose = (await close.boundingBox())!;
    expect(scrolledClose.y).toBeGreaterThanOrEqual(sheetBox.y);
    await phone.screenshot({ path: testInfo.outputPath('lookup-scrolled.png') });

    // Escape closes the sheet and hands focus back to the word.
    await phone.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(token).toBeFocused();

    // Brackets come off too; a new step closes an open sheet.
    await phone.locator('.learner-slide__plate [data-token]', { hasText: '(vraiment)' }).click();
    await expect(phone.getByRole('dialog', { name: 'Dictionary: vraiment', exact: true }).locator('.learner-lookup__meaning')).toHaveText('meaning of vraiment');
    expect(asked).toEqual(['passé', 'vraiment']);
    await command(seed.sessionCode, seed.hostToken, { command: 'outline.goto', stepId: 'end' });
    await expect(phone.getByText('Fin', { exact: true }).first()).toBeVisible();
    await expect(phone.getByRole('dialog')).toHaveCount(0);
    await context.close();
  });

  test('a personal link opened before the start waits, then enters on its own', async ({ page, browser }) => {
    const api = await signIn(page);
    const seed = await seedIdentifiedLobby(api, OUTLINE);

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    await phone.goto(joinUrl(seed.code, seed.linkToken));
    await expect(phone.getByText('Waiting for your tutor to start', { exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    await expect(phone.getByRole('button', { name: 'Rejoin with handle' })).toHaveCount(0);
    await expect(phone.getByText(seed.code)).toHaveCount(0);

    await command(seed.sessionCode, seed.hostToken, { command: 'session.start' });
    await expect(phone.getByText('Bonjour', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    expect(new URL(phone.url()).searchParams.has('link')).toBe(false);

    // Leave names the way back; the code alone then says to use the link.
    await phone.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(
      phone.getByText('Leave this session? Open the personal link your tutor sent you to come back to the lesson.', { exact: true }),
    ).toBeVisible();
    await phone.getByRole('button', { name: 'Leave session', exact: true }).click();
    await phone.getByRole('textbox', { name: 'Join code' }).fill(seed.code);
    await phone.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      phone.getByText('Open the personal link your tutor sent you to come back to the lesson.', { exact: true }),
    ).toBeVisible();

    // The link re-seats the learner; the ended view points at the lesson page.
    await phone.goto(joinUrl(seed.code, seed.linkToken));
    await expect(phone.getByText('Bonjour', { exact: true }).first()).toBeVisible();
    await command(seed.sessionCode, seed.hostToken, { command: 'session.end' });
    await expect(phone.getByText('Session ended', { exact: true })).toBeVisible();
    await expect(phone.getByText('Your personal link opens your lesson page.', { exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Leave', exact: true })).toHaveCount(0);
    await context.close();
  });
});

async function signIn(page: Page): Promise<APIRequestContext> {
  const api = page.request;
  const res = await api.post(`${BASE}/api/auth/demo/login`, {
    headers: CSRF,
    data: { username: 'alice', password: 'demo' },
  });
  expect(res.status(), 'demo auth must be enabled on the dev worker').toBe(200);
  const context = page.context();
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, secure: false })));
  return api;
}

const LOOKUP = {
  version: 1,
  meta: { title: 'Phone lookup', subject: 'French', level: 'A2' },
  steps: [
    { id: 'read', kind: 'statement', title: 'Hier', body: 'Il est passé, (vraiment) hier.' },
    { id: 'end', kind: 'title', title: 'Fin' },
  ],
  interactions: [],
};

/** An entry with a forms table taller than the sheet. */
function longEntry(word: string) {
  return {
    word,
    lemma: word,
    lang: 'fr',
    pos: 'verb',
    labels: [],
    senses: [{ gloss: `meaning of ${word}` }],
    sections: [
      {
        key: 'indicative-present',
        label: 'Present',
        columnLabels: ['Form'],
        rows: Array.from({ length: 12 }, (_, index) => ({ label: `Person ${index + 1}`, cells: [`${word}${index}`] })),
      },
      {
        key: 'indicative-past',
        label: 'Past',
        columnLabels: ['Form'],
        rows: Array.from({ length: 12 }, (_, index) => ({ label: `Person ${index + 1}`, cells: [`${word}-p${index}`] })),
      },
    ],
    source: { name: 'Test dictionary', url: 'https://dictionary.invalid/' },
  };
}

async function seedIdentifiedLobby(api: APIRequestContext, outline: typeof OUTLINE | typeof LOOKUP) {
  const stamp = Date.now();
  const contextRes = await api.post(`${BASE}/api/tutoring/contexts`, {
    headers: CSRF,
    data: { displayName: `Léa ${stamp}`, kind: 'person', context: { language: 'fr' } },
  });
  expect(contextRes.status()).toBe(201);
  const { id: contextId, spaceId } = (await contextRes.json()).context as { id: string; spaceId: string };
  const deckRes = await api.post(`${BASE}/api/decks`, {
    headers: CSRF,
    data: {
      title: `Phone states ${stamp}`,
      contextId,
      spaceId,
      shape: 'tutoring',
      createSession: true,
      content: { ...outline, defaults: { identityMode: 'identified' } },
    },
  });
  expect(deckRes.status()).toBe(201);
  const sessionId: string = (await deckRes.json()).session.id;
  const launchRes = await api.post(`${BASE}/api/sessions/${sessionId}/launch`, {
    headers: CSRF,
    data: { start: false },
  });
  expect(launchRes.status()).toBe(201);
  const launched = (await launchRes.json()) as { code: string; sessionCode: string; hostToken: string };
  const linkRes = await api.post(`${BASE}/api/tutoring/contexts/${contextId}/links`, { headers: CSRF, data: {} });
  expect(linkRes.status()).toBe(201);
  return { ...launched, linkToken: (await linkRes.json()).token as string };
}

function joinUrl(code: string, link: string): string {
  const url = new URL(participantUrl(code));
  url.searchParams.set('link', link);
  return url.toString();
}
