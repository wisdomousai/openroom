/**
 * `GET /api/my/home` — the Library's write-notes prompt. It lists a session
 * once it is over (ended, or past the recovery window) and still has no Notes,
 * names the student it was taught to, and never points at a Notes page the
 * space owner's plan locks.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { RECOVERY_WINDOW_MS } from '../src/control';
import { SMOKE_OUTLINE } from './helpers';
import { account, member, subscribe, type Account } from './paid-fixtures';

const OUTLINE = { ...SMOKE_OUTLINE, steps: [{ id: 'question', kind: 'interaction', interactionId: 'warmup' }] };

async function session(tutor: Account, context: { id: string; spaceId: string }, title: string): Promise<string> {
  const created = await tutor.request('/api/decks', 'POST', { spaceId: context.spaceId, contextId: context.id, content: { ...OUTLINE, meta: { title } }, createSession: true });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.session.id as string;
}

/** The launch row the live plane writes; `createdAt` and `ended` are what the prompt keys on. */
async function delivered(tutor: Account, sessionId: string, spaceId: string, createdAt: number, ended: boolean) {
  await env.DB.prepare('INSERT INTO live_sessions (code, user_id, title, created_at, ended, session_id, space_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(crypto.randomUUID().slice(0, 8).toUpperCase(), tutor.id, 'Live', createdAt, ended ? 1 : 0, sessionId, spaceId).run();
}

async function prompts(tutor: Account): Promise<{ sessionId: string; title: string; contextName: string | null }[]> {
  const home = await tutor.request('/api/my/home');
  expect(home.status).toBe(200);
  return home.body.needsRecord;
}

describe('write-notes prompt', () => {
  it('lists ended and settled sessions without Notes, newest first, with the student name', async () => {
    const owner = await account();
    const change = await subscribe(owner);
    const created = await owner.request('/api/tutoring/contexts', 'POST', { displayName: 'Léa', kind: 'person', context: {} });
    expect(created.status).toBe(201);
    const context = created.body.context as { id: string; spaceId: string };
    const now = Date.now();
    const ended = await session(owner, context, 'Au café');
    const settled = await session(owner, context, 'Au marché');
    const teaching = await session(owner, context, 'En train');
    const written = await session(owner, context, 'À la gare');
    await session(owner, context, 'Never started');
    await delivered(owner, ended, context.spaceId, now - 60_000, true);
    await delivered(owner, settled, context.spaceId, now - RECOVERY_WINDOW_MS - 60_000, false);
    await delivered(owner, teaching, context.spaceId, now - 60_000, false);
    await delivered(owner, written, context.spaceId, now - 30_000, true);
    expect((await owner.request(`/api/sessions/${written}/record`, 'PUT', { outcomes: [], notes: '', homework: [], artifacts: [] })).status).toBe(200);

    expect(await prompts(owner)).toEqual([
      expect.objectContaining({ sessionId: ended, title: 'Au café', contextName: 'Léa' }),
      expect.objectContaining({ sessionId: settled, title: 'Au marché', contextName: 'Léa' }),
    ]);

    // A member of the space sees the same prompt; a lapsed owner plan hides it from both.
    const editor = await account();
    await member(owner, editor, 'editor', context.spaceId);
    expect((await prompts(editor)).map((row) => row.sessionId)).toEqual([ended, settled]);
    await change('canceled');
    expect(await prompts(owner)).toEqual([]);
    expect(await prompts(editor)).toEqual([]);
  });
});
