/**
 * The core renderer's destinations: its own file view, the workspace pages
 * when the build ships them, and nothing when it does not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  destinationHref,
  probeWorkspace,
  workspaceAvailable,
  workspaceRoute,
  workspaceShareUrl,
} from './destinations';

describe('workspaceRoute', () => {
  it('opens the Library at the deck’s own row', () => {
    expect(workspaceRoute({ kind: 'library', place: { spaceId: 's1', folderId: 'f1', itemId: 'd1' } }))
      .toBe('/space/s1?folderId=f1&itemId=d1');
    expect(workspaceRoute({ kind: 'library' })).toBe('/space');
    expect(workspaceRoute({ kind: 'library', place: { spaceId: null } })).toBe('/space');
  });

  it('maps session and account destinations to the workspace routes', () => {
    expect(workspaceRoute({ kind: 'spaceMembers', spaceId: 's 1' })).toBe('/space/s%201/members');
    expect(workspaceRoute({ kind: 'sessionConsole', sessionCode: 'ABCD1234' })).toBe('/sessions/ABCD1234');
    expect(workspaceRoute({ kind: 'sessionRemote', sessionCode: 'ABCD1234' })).toBe('/sessions/ABCD1234/remote');
    expect(workspaceRoute({ kind: 'sessionQna', sessionCode: 'ABCD1234' })).toBe('/sessions/ABCD1234/qna');
    expect(workspaceRoute({ kind: 'sessionRecap', sessionCode: 'ABCD1234' })).toBe('/sessions/ABCD1234/recap');
    expect(workspaceRoute({ kind: 'sessionNotes', sessionId: 'ses_1' })).toBe('/sessions/ses_1/record');
    expect(workspaceRoute({ kind: 'plans' })).toBe('/settings/billing');
  });
});

describe('destinationHref', () => {
  it('keeps the deck view in the core renderer', () => {
    expect(destinationHref({ kind: 'deckDocument' }, false)).toBe('/core/index.html#/file');
    expect(destinationHref({ kind: 'deckDocument' }, true)).toBe('/core/index.html#/file');
  });

  it('opens workspace pages in the workspace bundle, and offers none without it', () => {
    expect(destinationHref({ kind: 'plans' }, true)).toBe('/host/index.html#/settings/billing');
    expect(destinationHref({ kind: 'plans' }, false)).toBeNull();
    expect(destinationHref({ kind: 'sessionConsole', sessionCode: 'ABCD1234' }, false)).toBeNull();
  });
});

describe('workspaceShareUrl', () => {
  it('puts the host token in the hash of the workspace page', () => {
    expect(workspaceShareUrl('remote', 'ABCD1234', 't/k', 'openroom://app'))
      .toBe('openroom://app/host/index.html#/sessions/ABCD1234/remote?token=t%2Fk');
    expect(workspaceShareUrl('qna', 'ABCD1234', 'tk', 'openroom://app'))
      .toBe('openroom://app/host/index.html#/sessions/ABCD1234/qna?token=tk');
  });
});

describe('probeWorkspace', () => {
  afterEach(async () => {
    await probeWorkspace(() => Promise.reject(new Error('reset')));
  });

  it('finds the workspace bundle when its entry is served', async () => {
    const asked: string[] = [];
    const found = await probeWorkspace((input, init) => {
      asked.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    expect(found).toBe(true);
    expect(workspaceAvailable()).toBe(true);
    expect(asked).toEqual(['HEAD /host/index.html']);
  });

  it('reports no workspace when the entry is missing or the request fails', async () => {
    expect(await probeWorkspace(() => Promise.resolve(new Response(null, { status: 404 })))).toBe(false);
    expect(workspaceAvailable()).toBe(false);
    expect(await probeWorkspace(() => Promise.resolve(new Response(null, { status: 403 })))).toBe(false);
    expect(await probeWorkspace(() => Promise.reject(new Error('offline')))).toBe(false);
  });
});
