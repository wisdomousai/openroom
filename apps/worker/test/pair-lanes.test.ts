/**
 * Pair-work lanes: which half of a split cards block a learner is handed.
 *
 * The contract under test is the *stability* of the assignment, because that is
 * what a session depends on:
 *  - lanes alternate over the order people arrived, from a persisted counter —
 *    not from the size of the participant map, which shrinks (retention purge)
 *    and would then re-pair everyone who joins afterwards;
 *  - a learner who reloads or re-enters keeps the lane they already had;
 *  - cards without a lane remain visible to both partners.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/tokens.js';
import { BASE, createSessionWithOutline, join, stateJson } from './helpers.js';
import type { SessionDO } from '../src/session-do.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

/** A tutoring outline whose one block is split down the middle. */
const SPLIT_OUTLINE = {
  version: 1,
  meta: { title: 'Ordering in a café', subject: 'French', level: 'B1' },
  defaults: { identityMode: 'pseudonymous' },
  steps: [
    {
      id: 'roles',
      kind: 'cards',
      title: 'Roles',
      items: [
        { text: 'You are the waiter', lane: 0 },
        { text: 'You are the customer', lane: 1 },
        { text: 'Be polite' },
      ],
    },
    { id: 'check', kind: 'interaction', interactionId: 'past-tense' },
  ],
  interactions: [
    {
      id: 'past-tense',
      type: 'choice',
      prompt: 'Choose the correct sentence.',
      options: [
        { id: 'a', label: "J'ai raté le train.", correct: true },
        { id: 'b', label: 'Je rate le train hier.' },
      ],
    },
  ],
};

async function seedCookie(): Promise<string> {
  const userId = `lane-user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Lane Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
  const signed = await signCookieValue(TOKEN_SECRET, sessionId);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

function asBrowser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

/** A started outline session, reached the way the tutor reaches it. */
async function outlineSession(): Promise<{ code: string; sessionCode: string; hostToken: string }> {
  const cookie = await seedCookie();
  const contextResponse = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Camille', kind: 'person', context: { level: 'B1' } }),
  });
  expect(contextResponse.status).toBe(201);
  const contextId = ((await contextResponse.json()) as { context: { id: string } }).context.id;

  const deckResponse = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({
      contextId,
      outline: SPLIT_OUTLINE,
      shape: 'tutoring',
      createSession: true,
    }),
  });
  expect(deckResponse.status).toBe(201);
  const sessionId = ((await deckResponse.json()) as { session: { id: string } }).session.id;

  const launched = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
    method: 'POST',
    body: JSON.stringify({ start: true }),
  });
  expect(launched.status).toBe(201);
  return (await launched.json()) as { code: string; sessionCode: string; hostToken: string };
}

async function laneOf(
  sessionCode: string,
  joined: { participantToken: string; participantId: string },
): Promise<unknown> {
  const snapshot = await stateJson(sessionCode, joined.participantToken, 'participant', {
    participantId: joined.participantId,
  });
  return (snapshot.outline as { yourLane?: unknown } | undefined)?.yourLane;
}

function stubFor(sessionCode: string): DurableObjectStub {
  const ns = (env as unknown as { SESSIONS: DurableObjectNamespace }).SESSIONS;
  return ns.get(ns.idFromName(sessionCode));
}

/** The persisted join counter — the thing lanes are actually derived from. */
function joinSeq(sessionCode: string): Promise<string | undefined> {
  return runInDurableObject(
    stubFor(sessionCode),
    (_instance: SessionDO, ctx: DurableObjectState) =>
      ctx.storage.sql
        .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'joinSeq'")
        .toArray()[0]?.v,
  );
}

describe('pair-work lane assignment', () => {
  it('alternates over join order and survives a re-entry', async () => {
    const session = await outlineSession();

    const first = await join(session.code);
    const second = await join(session.code);
    const third = await join(session.code);

    expect(await laneOf(session.sessionCode, first)).toBe(0);
    expect(await laneOf(session.sessionCode, second)).toBe(1);
    expect(await laneOf(session.sessionCode, third)).toBe(0);

    // Re-entry by handle is the pseudonymous rejoin path: the same seat, so the
    // same side of the pair — a learner whose page reloads mid-activity must not
    // swap partners.
    const again = await join(session.code, second.handle);
    expect(again.participantId).toBe(second.participantId);
    expect(await laneOf(session.sessionCode, again)).toBe(1);

    // The counter, not the participant map, is what the next lane comes from:
    // three people joined, three seats were handed out, and a rejoin took none.
    expect(await joinSeq(session.sessionCode)).toBe('3');
  });

  it('shows unpaired cards to both partners', async () => {
    const items = [{ text: 'Discuss together' }, { text: 'Name a next step' }];
    const session = await createSessionWithOutline({ version: 1, meta: { title: 'Shared cards' }, interactions: [], steps: [{ id: 'shared', kind: 'cards', title: 'Together', items }] });
    for (const person of [await join(session.code), await join(session.code)]) {
      const snapshot = await stateJson(session.code, person.participantToken, 'participant', { participantId: person.participantId });
      expect(snapshot.outline.currentStep.items).toEqual(items);
    }
  });

  it('a lost participant does not re-pair the people who join after them', async () => {
    const session = await outlineSession();
    const first = await join(session.code);
    await join(session.code);
    await join(session.code);
    expect(await joinSeq(session.sessionCode)).toBe('3');

    /*
     * Nothing in the product removes one participant today — the retention
     * purge empties the whole map — so the shrink is staged in storage and the
     * in-memory cache is dropped to force a reload from it. The regression this pins
     * is parity taken over `participants`: two people left in the map would
     * hand the fourth joiner lane 0, i.e. the same side as the person they were
     * meant to be paired with.
     */
    await runInDurableObject(stubFor(session.sessionCode), (_instance: SessionDO, ctx: DurableObjectState) => {
      const row = ctx.storage.sql
        .exec<{ state: string }>('SELECT state FROM session WHERE id = 1')
        .toArray()[0];
      const state = JSON.parse(row?.state ?? '{}') as {
        participants: Record<string, unknown>;
      };
      delete state.participants[first.participantId];
      ctx.storage.sql.exec('UPDATE session SET state = ? WHERE id = 1', JSON.stringify(state));
    });
    await runInDurableObject(stubFor(session.sessionCode), (instance: SessionDO) => {
      instance.simulateHibernationWakeForTest();
    });

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.participantCount).toBe(2);

    const fourth = await join(session.code);
    expect(await laneOf(session.sessionCode, fourth)).toBe(1);
  });
});
