/**
 * UC-43 — A session on a relay with no control plane
 * Contract: docs/journeys/UC-43-relay-only.md
 *
 * Runs against OPENROOM_RELAY_URL (verify:browser starts a relay-only runtime
 * on its own port) with OPENROOM_RELAY_KEY. There is no workspace, no D1 and
 * no host app on that origin: the key creates the session, the stage and the
 * participant pages are the relay's own.
 */
import { test, expect } from '@playwright/test';
import { loadExampleSession } from '../fixtures/session';

const relayUrl = (process.env.OPENROOM_RELAY_URL ?? '').replace(/\/$/, '');
const relayKey = process.env.OPENROOM_RELAY_KEY ?? '';

const INTERACTION = 'myth-great-idea';
const LABEL_TRUE = 'True — the idea is the hard part';
const LABEL_FALSE = 'False — finding a customer who pays is the hard part';

interface RelaySession {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  joinUrl: string;
}

function relay(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${relayUrl}${path}`, init);
}

async function create(outline: unknown, key: string | null): Promise<Response> {
  return relay('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ outline }),
  });
}

async function command(sessionCode: string, token: string, cmd: Record<string, unknown>): Promise<void> {
  const res = await relay(`/api/sessions/${sessionCode}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), command: cmd }),
  });
  if (!res.ok) throw new Error(`command ${JSON.stringify(cmd)} failed: ${res.status} ${await res.text()}`);
}

async function joinApi(code: string, body: Record<string, unknown> = {}): Promise<Response> {
  return relay('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...body }),
  });
}

test.describe('UC-43 relay-only session', () => {
  test.skip(relayUrl === '' || relayKey === '', 'Needs OPENROOM_RELAY_URL and OPENROOM_RELAY_KEY (bun run verify:browser sets both).');

  test('the relay key creates the session; only the relay serves it', async () => {
    const health = await relay('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const outline = loadExampleSession('seg-camp');
    expect((await create(outline, null)).status).toBe(401);
    expect((await create(outline, 'wrong-key')).status).toBe(401);

    const created = await create(outline, relayKey);
    expect(created.status).toBe(201);
    const session = (await created.json()) as RelaySession;
    expect(session.joinUrl).toBe(`/join/?code=${session.code}`);

    // No control plane on this origin: no host app, no workspace API.
    expect((await relay('/host/')).status).toBe(404);
    expect((await relay('/api/me')).status).toBe(404);

    // Identified joins verify workspace invites; the relay has none.
    const identified = await joinApi(session.code, { contextLink: 'any' });
    expect(identified.status).toBe(403);
    expect(await identified.json()).toMatchObject({ error: 'identified-join-unavailable' });
  });

  test('stage and participant pages on the relay run a choice to reveal', async ({ page, browser }) => {
    const created = await create(loadExampleSession('seg-camp'), relayKey);
    expect(created.status).toBe(201);
    const session = (await created.json()) as RelaySession;
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: INTERACTION });

    // The participant opens the relay's own join link and answers.
    await page.goto(new URL(session.joinUrl, `${relayUrl}/`).toString());
    const joinButton = page.getByRole('button', { name: 'Join', exact: true });
    await joinButton.waitFor({ state: 'visible', timeout: 20_000 });
    await joinButton.click();
    await page.getByRole('radio', { name: new RegExp(LABEL_FALSE) }).click({ timeout: 20_000 });

    // Two more anonymous participants over the API.
    for (const optionId of ['true-hardest', 'false-execution']) {
      const joined = await joinApi(session.code);
      expect(joined.status).toBe(200);
      const participant = (await joined.json()) as { participantToken: string };
      await command(session.sessionCode, participant.participantToken, {
        command: 'answer.submit',
        interactionId: INTERACTION,
        answer: { kind: 'choice', optionIds: [optionId] },
      });
    }

    const stage = await browser.newPage();
    const stageUrl = new URL('/stage/', relayUrl);
    stageUrl.searchParams.set('session', session.sessionCode);
    stageUrl.searchParams.set('token', session.stageToken);
    await stage.goto(stageUrl.toString());
    const summary = stage.locator('figcaption[role="status"]');
    await expect(summary).toContainText(/3 answers/i, { timeout: 20_000 });
    await expect(stage.locator('.barrow')).toHaveCount(0);

    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: INTERACTION });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: INTERACTION });

    await expect(stage.locator('.barrow')).toHaveCount(2, { timeout: 20_000 });
    await expect(stage.locator('.barrow--correct')).toContainText(LABEL_FALSE);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results).toBeVisible({ timeout: 20_000 });
    await expect(results).toContainText(LABEL_TRUE);
    await expect(results).toContainText(LABEL_FALSE);
    await stage.close();

    // The ballots export is the relay's record of the session.
    const csv = await relay(`/api/sessions/${session.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(csv.status).toBe(200);
    expect((await csv.text()).split('\n').filter((line) => line.startsWith(`${INTERACTION},`))).toHaveLength(3);
  });
});
