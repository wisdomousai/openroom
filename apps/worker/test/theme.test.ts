/**
 * Live theming over the wire: the host switches the session theme and every role's
 * snapshot reflects it at the new revision. Exercised through the HTTP surface
 * only, like the rest of this suite.
 */
import { describe, expect, it } from 'vitest';

import { command, createLiveSession, createSessionWithOutline, join, stateJson } from './helpers.js';

const THEMED_OUTLINE = {
  version: 1,
  meta: { title: 'Themed outline' },
  defaults: { theme: 'chalkboard' },
  interactions: [{ id: 'ask', type: 'qna', prompt: 'Ask anything' }],
};

describe('session.theme over the wire', () => {
  it('host switches the theme and the participant sees it', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);

    const before = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(before.theme).toBe('default');

    const res = await command(session.sessionCode, session.hostToken, {
      command: 'session.theme',
      theme: 'sherbet',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; revision: number };
    expect(body.ok).toBe(true);
    expect(body.revision).toBe(before.revision + 1);

    const after = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(after.theme).toBe('sherbet');
    expect(after.revision).toBe(body.revision);

    // Stage and host see the same theme at the same revision.
    const stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(stage.theme).toBe('sherbet');
    expect(host.theme).toBe('sherbet');
  });

  it('outline defaults.theme seeds the session', async () => {
    const session = await createSessionWithOutline(THEMED_OUTLINE);
    const participant = await join(session.code);
    const snapshot = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(snapshot.theme).toBe('chalkboard');
  });

  it('an unknown theme is rejected with E_INVALID_THEME and changes nothing', async () => {
    const session = await createLiveSession();
    const res = await command(session.sessionCode, session.hostToken, {
      command: 'session.theme',
      theme: 'neon-vaporwave',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('E_INVALID_THEME');

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(host.theme).toBe('default');
  });

  it('a participant cannot change the theme', async () => {
    const session = await createLiveSession();
    const participant = await join(session.code);
    const res = await command(session.sessionCode, participant.participantToken, {
      command: 'session.theme',
      theme: 'paper',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe('E_FORBIDDEN');
  });

  it('re-sending the same theme is a no-op that does not bump the revision', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.theme', theme: 'projector' });
    const first = await stateJson(session.sessionCode, session.hostToken, 'host');

    const res = await command(session.sessionCode, session.hostToken, {
      command: 'session.theme',
      theme: 'projector',
    });
    expect(res.status).toBe(200);

    const second = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(second.revision).toBe(first.revision);
    expect(second.theme).toBe('projector');
  });
});
