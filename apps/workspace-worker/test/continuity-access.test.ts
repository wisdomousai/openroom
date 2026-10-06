/**
 * The paid `continuity` capability: who it is read from (the space owner), what
 * it gates (the teaching loop: Notes, links, learner work, identified sessions,
 * the learner plane), what it never gates (contexts of any kind, deletion,
 * restore, the shared lookup tools), and that a deployment without billing is
 * unlocked.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import { BASE, SMOKE_OUTLINE as QUESTION_OUTLINE } from './helpers';
import { account, clients, configured, member, subscribe, type Account } from './paid-fixtures';

const OUTLINE = { ...QUESTION_OUTLINE, steps: [{ id: 'question', kind: 'interaction', interactionId: 'warmup' }] };
const IDENTIFIED = { ...OUTLINE, defaults: { ...OUTLINE.defaults, identityMode: 'identified' } };
const selfHosted: Env = { ...configured, PADDLE_ENVIRONMENT: undefined, PADDLE_PRICE_CATALOG: undefined };
const REQUIRED = { ok: false, error: 'continuity-required' };
const NOTES = { notes: 'Private', nextNote: 'Start with the past tense', outcomes: [], homework: [], artifacts: [] };

async function learner(token: string, target: Env = configured): Promise<{ status: number; body: unknown }> {
  const response = await worker.fetch(new Request(`${BASE}/api/learner/me`, { headers: { authorization: `Bearer ${token}` } }), target);
  return { status: response.status, body: await response.json() };
}

/** A context with one session filed against it. Free for every kind. */
async function contextSetup(tutor: Account, kind: 'person' | 'class' = 'person') {
  const created = await tutor.request('/api/tutoring/contexts', 'POST', {
    displayName: kind === 'class' ? 'Year 9 French' : 'Camille', kind, context: {},
    ...(kind === 'class' ? { experience: 'classroom' } : {}),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const context = created.body.context as { id: string; spaceId: string };
  const deck = await tutor.request('/api/decks', 'POST', { spaceId: context.spaceId, contextId: context.id, content: OUTLINE, createSession: true });
  expect(deck.status, JSON.stringify(deck.body)).toBe(201);
  return { context, base: `/api/tutoring/contexts/${context.id}`, record: `/api/sessions/${deck.body.session.id}/record`, deckId: deck.body.deck.id as string };
}

/** The loop on top: one learner link. Needs `continuity`. */
async function loopSetup(tutor: Account, kind: 'person' | 'class' = 'person') {
  const setup = await contextSetup(tutor, kind);
  const link = await tutor.request(`${setup.base}/links`, 'POST', kind === 'class' ? { displayName: 'Noah' } : {});
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  return { ...setup, link: link.body as { id: string; token: string } };
}

const loopPaths = (setup: { base: string; record: string }): [string, string, object?][] => [
  [`${setup.base}/links`, 'GET'], [`${setup.base}/links`, 'POST', {}], [`${setup.base}/learners`, 'GET'],
  [`${setup.base}/returned`, 'GET'], [`${setup.base}/work`, 'GET'],
  [setup.record, 'GET'], [setup.record, 'PUT', NOTES],
];

describe('continuity capability', () => {
  it('keeps contexts of every kind, decks, live sessions and lookup tools free, and gates the loop', async () => {
    const free = await account();
    for (const client of clients) {
      for (const kind of ['person', 'class'] as const) {
        const created = await free.request('/api/tutoring/contexts', 'POST', { displayName: `${client} ${kind}`, kind }, client);
        expect(created.status, `${client} ${kind}`).toBe(201);
        const base = `/api/tutoring/contexts/${created.body.context.id}`;
        expect((await free.request(base, 'GET', undefined, client)).status).toBe(200);
        expect((await free.request(base, 'PATCH', { displayName: `${client} ${kind} renamed` }, client)).body.context.displayName).toBe(`${client} ${kind} renamed`);
      }
    }
    expect((await free.request('/api/tutoring/contexts')).body.contexts).toHaveLength(clients.length * 2);
    expect((await free.request('/api/tutoring/contexts?kind=class')).body.contexts).toHaveLength(clients.length);

    const person = await contextSetup(free, 'person'), group = await contextSetup(free, 'class');
    expect((await free.request(`/api/tutoring/contexts?spaceId=${group.context.spaceId}`)).body.contexts).toHaveLength(1);
    expect((await free.request('/api/my/spaces', 'POST', { name: 'Spanish', contextId: person.context.id })).status).toBe(201);
    for (const client of clients) {
      for (const setup of [person, group]) {
        for (const [path, method, body] of loopPaths(setup)) {
          expect(await free.request(path, method, body, client), `${client} ${method} ${path}`).toMatchObject({ status: 403, body: REQUIRED });
        }
      }
    }

    // Shared prefix, not the loop: these answer on their own terms.
    for (const [path, method] of [['lookup', 'POST'], ['dictionary', 'POST'], ['stock', 'GET'], ['embed-check', 'POST'], ['embed-import', 'POST']] as const) {
      const response = await free.request(`/api/tutoring/${path}`, method, method === 'POST' ? {} : undefined);
      expect(response.status, path).not.toBe(403);
      expect(JSON.stringify(response.body), path).not.toContain('continuity-required');
    }
    const deck = await free.request('/api/decks', 'POST', { spaceId: free.spaceId, content: OUTLINE });
    expect(deck.status).toBe(201);
    expect((await free.request(`/api/decks/${deck.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() })).status).toBe(201);
    expect((await free.request('/api/sessions', 'POST', { outline: OUTLINE })).status).toBe(201);
    expect((await free.request(`/api/decks/${person.deckId}/start`, 'POST', { requestId: crypto.randomUUID() })).status).toBe(201);

    // Identified sessions are part of the loop on every creation path.
    for (const client of ['cookie', 'pat', 'oauth'] as const) expect(await free.request('/api/sessions', 'POST', { outline: IDENTIFIED }, client)).toEqual({ status: 403, body: REQUIRED });
    expect((await free.rpc('session_create', { outline: IDENTIFIED })).error).toBe(true);
    const identifiedDeck = await free.request('/api/decks', 'POST', { spaceId: free.spaceId, content: IDENTIFIED });
    expect((await free.request(`/api/decks/${identifiedDeck.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() }, 'mcp')).status).toBe(403);

    // The same account with a subscription carrying `continuity`.
    await subscribe(free);
    const link = await free.request(`${group.base}/links`, 'POST', { displayName: 'Noah' });
    expect(link.status).toBe(201);
    expect((await learner(link.body.token)).status).toBe(200);
    expect((await free.request(person.record, 'PUT', NOTES, 'mcp')).status).toBe(200);
    expect((await free.request('/api/sessions', 'POST', { outline: IDENTIFIED }, 'oauth')).status).toBe(201);
  });

  it('retains data after a lapse, keeps contexts, deletion and restore open, and answers a lapsed learner link like a revoked one', async () => {
    const tutor = await account(), change = await subscribe(tutor);
    const setup = await loopSetup(tutor);
    const spare = await tutor.request(`${setup.base}/links`, 'POST', {});
    expect((await tutor.request(setup.record, 'PUT', NOTES)).status).toBe(200);
    expect((await tutor.request(setup.base)).body.context.nextNote).toBe(NOTES.nextNote);

    await change('canceled');
    for (const client of clients) {
      for (const [path, method, body] of loopPaths(setup)) expect(await tutor.request(path, method, body, client), `${client} ${method} ${path}`).toMatchObject({ status: 403, body: REQUIRED });
    }
    expect(await tutor.request('/api/sessions', 'POST', { outline: IDENTIFIED })).toEqual({ status: 403, body: REQUIRED });

    // The context stays usable; only the Notes sticky is withheld.
    const detail = await tutor.request(setup.base);
    expect(detail.status).toBe(200);
    expect(detail.body.context).not.toHaveProperty('nextNote');
    expect((await tutor.request(setup.base, 'PATCH', { displayName: 'Camille B.' })).status).toBe(200);
    const listed = (await tutor.request(`/api/tutoring/contexts?spaceId=${setup.context.spaceId}`)).body.contexts;
    expect(listed.map((row: { id: string }) => row.id)).toEqual([setup.context.id]);
    expect(listed[0]).not.toHaveProperty('nextNote');

    // Lapsed and revoked links are indistinguishable to the holder.
    expect((await tutor.request(`${setup.base}/links/${spare.body.id}`, 'DELETE')).status).toBe(200);
    const lapsed = await learner(setup.link.token), revoked = await learner(spare.body.token);
    expect(lapsed).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(lapsed).toEqual(revoked);

    // Privacy deletion is never paid.
    expect((await tutor.request(setup.base, 'DELETE', undefined, 'mcp')).status).toBe(200);
    expect((await tutor.request('/api/tutoring/contexts?trash=1')).body.contexts.map((row: { id: string }) => row.id)).toEqual([setup.context.id]);
    expect((await tutor.request(`${setup.base}/restore`, 'POST', {}, 'pat')).status).toBe(200);
    expect((await tutor.request(setup.base, 'DELETE')).status).toBe(200);
    expect((await tutor.request(`${setup.base}/permanent-deletion`, 'POST', {})).status).toBe(202);

    // Nothing was deleted by the lapse itself: renewal brings the record back.
    expect((await tutor.request(`${setup.base}/restore`, 'POST', {})).status).toBe(200);
    await change('active');
    expect((await tutor.request(setup.record, 'GET')).body.record.notes).toBe('Private');
    expect((await tutor.request(setup.base)).body.context.nextNote).toBe(NOTES.nextNote);
    expect((await learner(setup.link.token)).status).toBe(200);
  });

  it('reads the space owner’s capability for editors, never the editor’s own', async () => {
    const owner = await account(), editor = await account(), change = await subscribe(owner);
    const setup = await loopSetup(owner, 'class');
    await member(owner, editor, 'editor', setup.context.spaceId);
    expect((await editor.request(`${setup.base}/links`, 'POST', { displayName: 'Lea' }, 'mcp')).status).toBe(201);
    expect((await editor.request(setup.record, 'PUT', NOTES, 'pat')).status).toBe(200);
    const identified = await editor.request('/api/decks', 'POST', { spaceId: setup.context.spaceId, contextId: setup.context.id, content: IDENTIFIED });
    expect((await editor.request(`/api/decks/${identified.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() })).status).toBe(201);

    await change('canceled');
    await subscribe(editor);
    expect((await editor.request(setup.base, 'GET', undefined, 'oauth')).status).toBe(200);
    expect(await editor.request(setup.record, 'GET')).toEqual({ status: 403, body: REQUIRED });
    expect(await editor.request(`${setup.base}/links`, 'GET')).toEqual({ status: 403, body: REQUIRED });
    expect((await editor.request(`/api/decks/${identified.body.deck.id}/start`, 'POST', { requestId: crypto.randomUUID() })).status).toBe(403);
    // The editor's own subscription covers the editor's own spaces.
    const own = await contextSetup(editor);
    expect((await editor.request(`${own.base}/links`, 'POST', {})).status).toBe(201);
  });

  it('unlocks everything on a deployment without billing', async () => {
    const tutor = await account(selfHosted);
    const me = await tutor.request('/api/me');
    expect(me.body.user.entitlements).toMatchObject({ continuity: true, team: true, keep: true, connectors: false });
    const setup = await loopSetup(tutor);
    expect((await learner(setup.link.token, selfHosted)).status).toBe(200);
    expect((await tutor.request(setup.record, 'PUT', NOTES)).status).toBe(200);
    expect((await tutor.request('/api/sessions', 'POST', { outline: IDENTIFIED })).status).toBe(201);
    expect((await tutor.request('/api/my/billing')).body).toMatchObject({ available: false, selfHosted: true });
    // The same account on the hosted configuration is free.
    expect((await worker.fetch(new Request(`${BASE}/api/learner/me`, { headers: { authorization: `Bearer ${setup.link.token}` } }), env as never)).status).toBe(401);
  });
});
