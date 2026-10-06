/**
 * UC-07 — Tutoring privacy: identified join and learner allowlist.
 *
 * Identified session → learner joins with an access link → host sees the
 * context name → stage never receives handles → session ends → the session
 * record's private notes and session code never reach `/api/learner/sessions`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { command, hostUrl, waitForWorker } from '../fixtures/session';

const BASE = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CSRF = { 'x-openroom-csrf': '1', 'content-type': 'application/json' };

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

interface Seeded {
  sessionId: string;
  code: string;
  sessionCode: string;
  hostToken: string;
  stageToken: string;
  linkToken: string;
  contextId: string;
}

async function seedTutoringRoom(api: APIRequestContext): Promise<Seeded> {
  const stamp = Date.now();

  const contextRes = await api.post(`${BASE}/api/tutoring/contexts`, {
    headers: CSRF,
    data: {
      displayName: `Léa ${stamp}`,
      kind: 'person',
      context: { language: 'fr', level: 'B1', goals: ['speaking'] },
    },
  });
  expect(contextRes.status()).toBe(201);
  const { id: contextId, spaceId } = (await contextRes.json()).context as { id: string; spaceId: string };

  const deckRes = await api.post(`${BASE}/api/decks`, {
    headers: CSRF,
    data: {
      title: `Privacy journey ${stamp}`,
      contextId,
      spaceId,
      shape: 'tutoring',
      createSession: true,
      content: {
        version: 1,
        meta: { title: 'Privacy deck', subject: 'French', level: 'B1' },
        defaults: { identityMode: 'identified' },
        steps: [
          { id: 'welcome', kind: 'title', title: 'Bienvenue' },
          {
            id: 'check',
            kind: 'interaction',
            interactionId: 'ready',
          },
        ],
        interactions: [
          {
            id: 'ready',
            type: 'choice',
            prompt: 'Ready to start?',
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        ],
      },
    },
  });
  expect(deckRes.status()).toBe(201);
  const sessionId: string = (await deckRes.json()).session.id;

  const launchRes = await api.post(`${BASE}/api/sessions/${sessionId}/launch`, {
    headers: CSRF,
    data: { start: true },
  });
  expect(launchRes.status()).toBe(201);
  const launched = (await launchRes.json()) as {
    code: string;
    sessionCode: string;
    hostToken: string;
    stageToken: string;
  };

  const linkRes = await api.post(`${BASE}/api/tutoring/contexts/${contextId}/links`, {
    headers: CSRF,
    data: {},
  });
  expect(linkRes.status()).toBe(201);
  const linkToken: string = (await linkRes.json()).token;

  return { sessionId, contextId, linkToken, ...launched };
}

function participantJoinUrl(code: string, link: string): string {
  const joinBase = process.env.OPENROOM_JOIN_URL?.replace(/\/$/, '') || `${BASE}/join`;
  const u = new URL(`${joinBase}/`);
  u.searchParams.set('code', code);
  u.searchParams.set('link', link);
  return u.toString();
}

async function hostState(
  api: APIRequestContext,
  sessionCode: string,
  hostToken: string,
): Promise<Record<string, unknown>> {
  const res = await api.get(`${BASE}/api/sessions/${sessionCode}/state?role=host`, {
    headers: { authorization: `Bearer ${hostToken}` },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

test.beforeAll(async () => {
  await waitForWorker();
});

test.describe('UC-07 tutoring privacy', () => {
  test('identified join names the learner; notes and session code stay off the learner plane', async ({
    page,
    browser,
  }) => {
    const api = await signIn(page);
    const seed = await seedTutoringRoom(api);

    const learner = await browser.newPage();
    await learner.goto(participantJoinUrl(seed.code, seed.linkToken));
    await expect(learner.getByText(/Bienvenue|Ready to start/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(learner.getByText(seed.code)).toHaveCount(0);
    await expect(learner.getByRole('button', { name: "I’m stuck" })).toHaveCount(0);

    const host = await hostState(api, seed.sessionCode, seed.hostToken);
    expect(host).not.toHaveProperty('signals');
    const handles = host.handles as Record<string, string> | undefined;
    if (handles) {
      expect(Object.values(handles).some((name) => name.startsWith('Léa'))).toBe(true);
    }

    const stageRes = await api.get(`${BASE}/api/sessions/${seed.sessionCode}/state?role=stage`, {
      headers: { authorization: `Bearer ${seed.stageToken}` },
    });
    expect(stageRes.status()).toBe(200);
    const stageBody = await stageRes.text();
    expect(stageBody).not.toMatch(/"handles"/);
    expect(stageBody).not.toMatch(/"signals"/);

    const end = await command(seed.sessionCode, seed.hostToken, { command: 'session.end' });
    expect(end.ok).toBe(true);

    const recordRes = await api.put(`${BASE}/api/sessions/${seed.sessionId}/record`, {
      headers: CSRF,
      data: {
        outcomes: ['Used passé composé independently'],
        notes: 'Private tutor note — must never reach the learner',
        homework: ['Write three travel sentences'],
        artifacts: [],
      },
    });
    expect(recordRes.status()).toBe(200);

    const learnerRuns = await api.get(`${BASE}/api/learner/sessions`, {
      headers: { authorization: `Bearer ${seed.linkToken}` },
    });
    expect(learnerRuns.status()).toBe(200);
    const learnerRaw = await learnerRuns.text();
    expect(learnerRaw).not.toContain('Private tutor note');
    expect(learnerRaw).not.toContain(seed.code);
    expect(learnerRaw).not.toMatch(/"notes"/);
    expect(learnerRaw).not.toMatch(/"sessionCode"|"room_code"/);

    await page.goto(hostUrl({ sessionCode: seed.sessionCode, hostToken: seed.hostToken } as never));
    await learner.close();
  });
});
