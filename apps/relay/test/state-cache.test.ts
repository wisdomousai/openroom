/**
 * GET state conditional revalidation (`afterRevision`).
 */
import { describe, expect, it } from 'vitest';

import { command, createLiveSession, getState, stateJson } from './helpers.js';

describe('state afterRevision', () => {
  it('returns 304 when afterRevision === current revision, and 200 when lower', async () => {
    const session = await createLiveSession();
    const before = await stateJson(session.sessionCode, session.hostToken, 'host');

    const notModified = await getState(session.sessionCode, session.hostToken, 'host', {
      afterRevision: String(before.revision),
    });
    expect(notModified.status).toBe(304);

    const stale = await getState(session.sessionCode, session.hostToken, 'host', {
      afterRevision: String(before.revision - 1 >= 0 ? before.revision - 1 : 0),
    });
    // if revision is already 0 this degenerates to afterRevision=0 === current -> still 200 only if revision > 0
    if (before.revision > 0) {
      expect(stale.status).toBe(200);
    }

    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const after = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(after.revision).toBeGreaterThan(before.revision);

    const stillFresh = await getState(session.sessionCode, session.hostToken, 'host', {
      afterRevision: String(before.revision),
    });
    expect(stillFresh.status).toBe(200);

    const nowCurrent = await getState(session.sessionCode, session.hostToken, 'host', {
      afterRevision: String(after.revision),
    });
    expect(nowCurrent.status).toBe(304);
  });
});
