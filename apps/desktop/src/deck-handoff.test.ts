import { describe, expect, it } from 'vitest';
import { stringifyOpenRoomFile, type OpenRoomFileV1 } from '@openroom/schema';

import { prepareDesktopDeckHandoff, type HandoffApi } from './deck-handoff.js';

const outline = {
  version: 1 as const,
  meta: { title: 'French revision' },
  steps: [{ id: 'hello', kind: 'title' as const, title: 'Bonjour' }],
  interactions: [{ id: 'q1', type: 'choice' as const, prompt: 'Pick', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
};

function api(responses: Array<{ status: number; body: unknown }>, calls: unknown[]): HandoffApi {
  return async (method, path, body) => {
    calls.push({ method, path, body });
    const response = responses.shift();
    if (response === undefined) throw new Error('unexpected API call');
    return response;
  };
}

describe('Desktop deck handoff', () => {
  it('reopens this device’s existing linked file', async () => {
    const existing: OpenRoomFileV1 = {
      format: 'openroom-file', fileVersion: 1, fileId: crypto.randomUUID(), localRevision: 2,
      remote: { origin: 'https://openroom.app/', deckId: 'd1', baseVersion: 3, baseContentHash: 'a'.repeat(64), baseOutline: outline },
      outline,
    };
    const result = await prepareDesktopDeckHandoff({
      origin: 'https://openroom.app', deckId: 'd1', device: { id: 'mac-1', name: 'Mac' },
      api: api([{ status: 200, body: { fileId: existing.fileId, locations: [{ deviceId: 'mac-1', path: '/decks/french.openroom' }] } }], []),
      readPath: async () => stringifyOpenRoomFile(existing), randomId: () => crypto.randomUUID(),
    });
    expect(result).toEqual({ kind: 'open-path', path: '/decks/french.openroom' });
  });

  it('creates an unsaved linked file when no local path exists', async () => {
    const calls: unknown[] = [];
    const fileId = crypto.randomUUID();
    const result = await prepareDesktopDeckHandoff({
      origin: 'https://openroom.app', deckId: 'deck one', device: { id: 'mac-1', name: 'Mac' },
      api: api([
        { status: 200, body: { fileId: null, locations: [] } },
        { status: 200, body: { deck: { title: 'French revision', currentVersion: 3 }, contentHash: 'b'.repeat(64), content: outline } },
        { status: 201, body: { linked: true, fileId } },
      ], calls),
      readPath: async () => { throw new Error('missing'); }, randomId: () => fileId,
    });
    expect(result.kind).toBe('open-source');
    if (result.kind === 'open-source') {
      expect(result.displayName).toBe('French-revision.openroom');
      expect(result.source).toContain(`fileId: ${fileId}`);
      expect(result.source).toContain('deckId: deck one');
    }
    expect(calls).toEqual([
      { method: 'GET', path: '/api/decks/deck%20one/file-link', body: undefined },
      { method: 'GET', path: '/api/decks/deck%20one', body: undefined },
      { method: 'POST', path: '/api/decks/deck%20one/file-link', body: { fileId } },
    ]);
  });

  it('requests normal Desktop sign-in on a 401', async () => {
    const result = await prepareDesktopDeckHandoff({
      origin: 'https://openroom.app', deckId: 'd1', device: { id: 'mac-1', name: 'Mac' },
      api: api([{ status: 401, body: { error: 'unauthorized' } }], []),
      readPath: async () => '', randomId: () => crypto.randomUUID(),
    });
    expect(result).toEqual({ kind: 'sign-in' });
  });
});
