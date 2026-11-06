/**
 * UC-44 — Participant phone states.
 *
 * A pause keeps a typed draft; accent keys write at the caret and keep the
 * field focused; typed gaps sit in the sentence with numbered labels and
 * practice hints; a ranking never starts in the authored order; Leave asks
 * first; the ended view drops Leave and the handle notice; a refused seat says
 * the session is no longer open; join failures read as plain sentences; a
 * personal link opened before the start waits and enters on its own.
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

  test('a personal link opened before the start waits, then enters on its own', async ({ page, browser }) => {
    const api = await signIn(page);
    const seed = await seedIdentifiedLobby(api);

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
      phone.getByText('Leave this session? To come back, open the personal link your tutor sent you.', { exact: true }),
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

async function seedIdentifiedLobby(api: APIRequestContext) {
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
      content: { ...OUTLINE, defaults: { identityMode: 'identified' } },
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
