/**
 * Tutor ink and answer keys, through the snapshot layer the surfaces actually
 * read.
 *
 * Two contracts live here:
 *  - ink (a mark, its colour, and a shown meaning) reaches the phone and the
 *    projector, and `mark.clear` takes the whole plate back — meaning included;
 *  - a fill-the-gaps's accepted answers and a match's correct pairing are **absent**
 *    from both of those snapshots until the interaction is revealed. The domain
 *    projects them (`snapshots.ts`); nothing above this line was pinning that
 *    the wire keeps the omission.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { CSRF_HEADER, SESSION_COOKIE } from '../src/auth.js';
import worker from '../src/index.js';
import { signCookieValue } from '../src/tokens.js';
import { BASE, command, join, stateJson } from './helpers.js';

const TOKEN_SECRET = (env as unknown as { TOKEN_SECRET: string }).TOKEN_SECRET;

const INK_OUTLINE = {
  version: 1,
  meta: { title: 'Le passé composé', subject: 'French', level: 'B1' },
  defaults: { identityMode: 'pseudonymous', resultVisibility: 'hidden-until-close' },
  steps: [
    { id: 'intro', kind: 'title', title: 'Le week-end dernier' },
    { id: 'gap-step', kind: 'interaction', interactionId: 'gap' },
    { id: 'pair-step', kind: 'interaction', interactionId: 'pair' },
  ],
  interactions: [
    {
      id: 'gap',
      type: 'fill-the-gaps',
      prompt: "J'{{g1}} raté le train.",
      gaps: [{ id: 'g1', answers: ['ai'] }],
    },
    {
      id: 'pair',
      type: 'match',
      prompt: 'Match the verbs',
      left: [
        { id: 'rater', label: 'rater le train' },
        { id: 'manquer', label: 'manquer de' },
      ],
      right: [
        { id: 'miss', label: 'to miss the train' },
        { id: 'lack', label: 'to lack' },
      ],
      correct: { rater: 'miss', manquer: 'lack' },
    },
  ],
};

async function seedCookie(): Promise<string> {
  const userId = `ink-user-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, created_at, entitlements)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}')`,
  )
    .bind(userId, `sub-${userId}`, `${userId}@example.com`, 'Ink Tutor', now)
    .run();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(sessionId, userId, now, now + 86_400_000)
    .run();
  return `${SESSION_COOKIE}=${encodeURIComponent(await signCookieValue(TOKEN_SECRET, sessionId))}`;
}

function asBrowser(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('content-type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  return worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env as never);
}

interface InkSession {
  code: string;
  sessionCode: string;
  hostToken: string;
  stageToken: string;
}

/** A live tutoring session, reached the way the tutor reaches it. */
async function inkSession(): Promise<InkSession> {
  const cookie = await seedCookie();
  const contextResponse = await asBrowser(cookie, '/api/tutoring/contexts', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Camille', kind: 'person', context: { level: 'B1' } }),
  });
  expect(contextResponse.status).toBe(201);
  const contextId = ((await contextResponse.json()) as { context: { id: string } }).context.id;

  const deckResponse = await asBrowser(cookie, '/api/decks', {
    method: 'POST',
    body: JSON.stringify({ contextId, outline: INK_OUTLINE, shape: 'tutoring', createSession: true }),
  });
  expect(deckResponse.status).toBe(201);
  const sessionId = ((await deckResponse.json()) as { session: { id: string } }).session.id;

  const launched = await asBrowser(cookie, `/api/sessions/${sessionId}/launch`, {
    method: 'POST',
    body: JSON.stringify({ start: true }),
  });
  expect(launched.status).toBe(201);
  const session = (await launched.json()) as { code: string; sessionCode: string; hostToken: string };

  const tokenResponse = await worker.fetch(
    new Request(`${BASE}/api/sessions/${session.sessionCode}/stage-token`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    }),
    env as never,
  );
  expect(tokenResponse.status).toBe(200);
  const { stageToken } = (await tokenResponse.json()) as { stageToken: string };
  return { ...session, stageToken };
}

describe('tutor ink over the wire', () => {
  // One session for the file: launching a tutoring session is a control-plane journey,
  // and both contracts below are about what its snapshots carry.
  let session: InkSession;
  let learner: Awaited<ReturnType<typeof join>>;
  const learnerView = () =>
    stateJson(session.sessionCode, learner.participantToken, 'participant', {
      participantId: learner.participantId,
    });
  const stageView = () => stateJson(session.sessionCode, session.stageToken, 'stage');

  beforeAll(async () => {
    session = await inkSession();
    learner = await join(session.code);
  });

  it('sends a mark and a shown meaning to the phone and the projector, and takes both back', async () => {
    expect(
      (
        await command(session.sessionCode, session.hostToken, {
          command: 'mark.set',
          mark: { kind: 'circle', partKey: 'header', token: 2, color: 'green' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await command(session.sessionCode, session.hostToken, {
          command: 'meaning.publish',
          stepId: INK_OUTLINE.steps[0]!.id,
          word: 'weekend',
          partKey: 'header',
          token: 2,
          text: 'last weekend',
        })
      ).status,
    ).toBe(200);


    for (const snapshot of [await learnerView(), await stageView()]) {
      // Tutor-only outline notes never ride a learner or projector snapshot.
      expect(JSON.stringify(snapshot)).not.toContain('tutorNotes');
      expect(snapshot.marks).toEqual([
        { kind: 'circle', partKey: 'header', token: 2, color: 'green', id: expect.any(String) },
      ]);
      expect(snapshot.meaning).toEqual({
        partKey: 'header',
        token: 2,
        text: 'last weekend',
        word: 'weekend',
        shown: true,
      });
    }

    // A dragged span of words, drawn as one underline, and rubbed out on its own.
    expect(
      (
        await command(session.sessionCode, session.hostToken, {
          command: 'mark.set',
          mark: { kind: 'underline', partKey: 'header', token: 0, endToken: 2, color: 'red' },
        })
      ).status,
    ).toBe(200);
    const withSpan = await learnerView();
    const span = (withSpan.marks as { kind: string; endToken?: number; id: string }[])[1];
    expect(span).toMatchObject({ kind: 'underline', endToken: 2 });
    expect(
      (await command(session.sessionCode, session.hostToken, { command: 'mark.remove', id: span?.id ?? '' }))
        .status,
    ).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      expect(snapshot.marks).toHaveLength(1);
      expect((snapshot.marks as { kind: string }[])[0]?.kind).toBe('circle');
    }

    expect((await command(session.sessionCode, session.hostToken, { command: 'mark.clear' })).status).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      expect(snapshot.marks).toBeUndefined();
      expect(snapshot.meaning).toBeUndefined();
    }
  });

  it('withholds fill-the-gaps answers and the match key until reveal', async () => {
    // Step 2 opens the fill-the-gaps; the gaps are on the wire, their answers are not.
    expect((await command(session.sessionCode, session.hostToken, { command: 'outline.next' })).status).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      const gaps = (snapshot.interaction as { gaps: { id: string; answers?: string[] }[] }).gaps;
      expect(gaps.map((gap) => gap.id)).toEqual(['g1']);
      expect(gaps.every((gap) => gap.answers === undefined)).toBe(true);
    }

    expect(
      (
        await command(session.sessionCode, session.hostToken, {
          command: 'interaction.reveal',
          interactionId: 'gap',
        })
      ).status,
    ).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      const gaps = (snapshot.interaction as { gaps: { answers?: string[] }[] }).gaps;
      expect(gaps[0]?.answers).toEqual(['ai']);
    }

    // The match key travels the same road.
    expect((await command(session.sessionCode, session.hostToken, { command: 'outline.next' })).status).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      expect((snapshot.interaction as { correct?: unknown }).correct).toBeUndefined();
    }
    expect(
      (
        await command(session.sessionCode, session.hostToken, {
          command: 'interaction.reveal',
          interactionId: 'pair',
        })
      ).status,
    ).toBe(200);
    for (const snapshot of [await learnerView(), await stageView()]) {
      expect((snapshot.interaction as { correct?: unknown }).correct).toEqual({
        rater: 'miss',
        manquer: 'lack',
      });
    }
  });
});
