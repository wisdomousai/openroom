/**
 * The host JSON export says which slide is showing and how much of it is
 * revealed, so an agent driving outline.next can read where the lesson is.
 */
import { describe, expect, it } from 'vitest';

import { call, command, createSessionWithOutline } from './helpers.js';

const OUTLINE = {
  version: 1,
  meta: { title: 'Le zoo' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Le zoo' },
    { id: 'rule', kind: 'statement', title: 'Le passé composé', body: 'avoir ou être', reveal: [['header'], ['body']] },
  ],
  interactions: [],
};

async function position(code: string, hostToken: string): Promise<unknown> {
  const response = await call(`/api/sessions/${code}/export?format=json`, { headers: { authorization: `Bearer ${hostToken}` } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { position?: unknown }).position;
}

describe('slide position in the JSON export', () => {
  it('follows outline.next through steps and reveal groups', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    expect(await position(session.code, session.hostToken)).toEqual({
      stepId: 'welcome', stepIndex: 0, stepCount: 2, kind: 'title', shownGroups: 1, revealGroups: 1,
    });
    await command(session.code, session.hostToken, { command: 'session.start' });
    expect((await command(session.code, session.hostToken, { command: 'outline.next' })).status).toBe(200);
    expect(await position(session.code, session.hostToken)).toMatchObject({ stepId: 'rule', stepIndex: 1, shownGroups: 1, revealGroups: 2 });
    expect((await command(session.code, session.hostToken, { command: 'outline.next' })).status).toBe(200);
    expect(await position(session.code, session.hostToken)).toMatchObject({ stepId: 'rule', shownGroups: 2, revealGroups: 2 });
  });
});
