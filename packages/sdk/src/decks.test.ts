import { describe, expect, it } from 'vitest';

import type { FetchLike } from './client.js';
import { createDeckClient, DeckConflictError, DeckError } from './decks.js';

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer;
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

function recorder(
  reply: (call: Call) => ReturnType<FetchLike> | { status: number; body: unknown },
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, ...(init ?? {}) };
    calls.push(call);
    const answer = reply(call);
    if (answer instanceof Promise) return answer;
    return res((answer as { status: number }).status, (answer as { body: unknown }).body);
  };
  return { fetch, calls };
}

const OUTLINE = {
  version: 1,
  meta: { title: 'French B1' },
  steps: [{ id: 'welcome', kind: 'title', title: 'Bonjour' }],
};

describe('deck client', () => {
  it('reads a deck, its place and a named version', async () => {
    const { fetch, calls } = recorder(() => ({
      status: 200,
      body: {
        deck: { id: 'd1', title: 'French B1', currentVersion: 3 },
        spaceName: 'Teaching',
        folderName: 'Camille',
        contentVersion: 3,
        content: OUTLINE,
      },
    }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test/', token: 'orpat_x', fetch });

    const detail = await client.decks.get('d1');
    expect(detail.deck.currentVersion).toBe(3);
    expect(detail.folderName).toBe('Camille');
    expect(calls[0]?.url).toBe('https://openroom.test/api/decks/d1');
    expect(calls[0]?.headers?.authorization).toBe('Bearer orpat_x');

    await client.decks.get('d 1', { version: 2 });
    expect(calls[1]?.url).toBe('https://openroom.test/api/decks/d%201?version=2');
  });

  it('lists versions newest first and tolerates an empty history', async () => {
    const { fetch } = recorder(() => ({
      status: 200,
      body: { deckId: 'd1', versions: [{ version: 2, createdAt: 2, createdBy: 'u1' }] },
    }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    expect(await client.decks.listVersions('d1')).toEqual([
      { version: 2, createdAt: 2, createdBy: 'u1' },
    ]);

    const empty = createDeckClient({
      baseUrl: 'https://openroom.test',
      fetch: recorder(() => ({ status: 200, body: { deckId: 'd1' } })).fetch,
    });
    expect(await empty.decks.listVersions('d1')).toEqual([]);
  });

  it('stamps a version with its baseVersion and the CSRF header', async () => {
    const { fetch, calls } = recorder(() => ({ status: 201, body: { deckId: 'd1', version: 4 } }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    expect(await client.decks.saveVersion('d1', OUTLINE, 3)).toEqual({ deckId: 'd1', version: 4 });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://openroom.test/api/decks/d1/versions');
    expect(calls[0]?.headers?.['x-openroom-csrf']).toBe('1');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ content: OUTLINE, baseVersion: 3 });
  });

  it('polls by ETag without downloading unchanged content', async () => {
    const calls: Call[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, ...(init ?? {}) });
      return res(304, undefined, { etag: 'W/"d1-3-hash"' });
    };
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    await expect(client.decks.getIfChanged('d1', 'W/"d1-3-hash"')).resolves.toEqual({
      changed: false,
      etag: 'W/"d1-3-hash"',
    });
    expect(calls[0]?.headers?.['if-none-match']).toBe('W/"d1-3-hash"');
  });

  it('links a file and reports the calling device location contract', async () => {
    const location = {
      deviceId: 'mac-1', deviceName: 'Classroom Mac', path: '/Lessons/French.openroom',
      localRevision: 8, contentHash: 'a'.repeat(64), syncedVersion: 4,
      syncedHash: 'b'.repeat(64), lastSeenAt: 1700,
    };
    const { fetch, calls } = recorder((call) => call.method === 'PUT'
      ? { status: 200, body: { location } }
      : { status: 200, body: { linked: true, fileId: 'file-1', locations: [location] } });
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    expect((await client.decks.getFileLink('d1')).locations[0]?.path).toBe('/Lessons/French.openroom');
    expect(await client.decks.reportFileLocation('d1', 'mac-1', {
      fileId: 'file-1', deviceName: location.deviceName, path: location.path,
      localRevision: 8, contentHash: location.contentHash, syncedVersion: 4,
      syncedHash: location.syncedHash,
    })).toEqual(location);
    expect(calls[1]?.url).toBe('https://openroom.test/api/decks/d1/file-locations/mac-1');
  });

  it('turns a 409 into a conflict carrying the server’s latest version', async () => {
    const { fetch } = recorder(() => ({
      status: 409,
      body: { error: 'version-conflict', latestVersion: 5 },
    }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    await expect(client.decks.saveVersion('d1', OUTLINE, 3)).rejects.toBeInstanceOf(
      DeckConflictError,
    );
    await client.decks.saveVersion('d1', OUTLINE, 3).catch((error: unknown) => {
      expect((error as DeckConflictError).latestVersion).toBe(5);
      expect((error as DeckConflictError).status).toBe(409);
    });
  });

  it('treats a missing draft as null but still throws on a real failure', async () => {
    const missing = createDeckClient({
      baseUrl: 'https://openroom.test',
      fetch: recorder(() => ({ status: 404, body: { error: 'not-found' } })).fetch,
    });
    expect(await missing.decks.getDraft('d1')).toBeNull();

    const broken = createDeckClient({
      baseUrl: 'https://openroom.test',
      fetch: recorder(() => ({ status: 403, body: { error: 'forbidden' } })).fetch,
    });
    await expect(broken.decks.getDraft('d1')).rejects.toBeInstanceOf(DeckError);
  });

  it('saves and discards working text without validating it', async () => {
    const { fetch, calls } = recorder((call) =>
      call.method === 'DELETE'
        ? { status: 204, body: undefined }
        : { status: 200, body: { deckId: 'd1', savedAt: 1700 } },
    );
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    expect(await client.decks.saveDraft('d1', 'version: 1\nmeta:\n  tit', 2)).toEqual({
      deckId: 'd1',
      savedAt: 1700,
    });
    expect(calls[0]?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      source: 'version: 1\nmeta:\n  tit',
      baseVersion: 2,
    });

    await expect(client.decks.discardDraft('d1')).resolves.toBeUndefined();
    expect(calls[1]?.method).toBe('DELETE');
  });

  it('start files a session and then launches it', async () => {
    const { fetch, calls } = recorder((call) =>
      call.url.endsWith('/launch')
        ? {
            status: 201,
            body: {
              sessionCode: 'SESS1234',
              joinUrl: 'https://x.test/?code=SESS1234',
              hostToken: 'h',
              stageToken: 's',
              sessionId: 'sess-9',
              deckId: 'd1',
              deckVersion: 3,
              status: 'live',
              started: true,
            },
          }
        : { status: 201, body: { session: { id: 'sess-9' } } },
    );
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    const started = await client.decks.start('d1', { version: 3 });
    expect(started.joinUrl).toBe('https://x.test/?code=SESS1234');
    expect(calls.map((c) => c.url)).toEqual([
      'https://openroom.test/api/sessions',
      'https://openroom.test/api/sessions/sess-9/launch',
    ]);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ deckId: 'd1', deckVersion: 3 });
    expect(JSON.parse(String(calls[1]?.body))).toEqual({ start: true });
  });

  it('start honours start:false so a session can be created without beginning', async () => {
    const { fetch, calls } = recorder((call) =>
      call.url.endsWith('/launch')
        ? { status: 201, body: { sessionCode: 'R', joinUrl: 'u', hostToken: 'h', stageToken: 's', sessionId: 'sess-9', deckId: 'd1', deckVersion: 1, status: 'draft', started: false } }
        : { status: 201, body: { session: { id: 'sess-9' } } },
    );
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    await client.decks.start('d1', { start: false });
    expect(JSON.parse(String(calls[1]?.body))).toEqual({ start: false });
  });

  it('uploads raw bytes with the file name and alt text in the query', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { fetch, calls } = recorder(() => ({
      status: 201,
      body: { asset: { id: 'a1', url: '/api/assets/a1', name: 'gare.jpg', kind: 'image' } },
    }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test', token: 't', fetch });
    const asset = await client.assets.upload('space-1', bytes, {
      name: 'gare.jpg',
      contentType: 'image/jpeg',
      alt: 'A station',
    });
    expect(asset.url).toBe('/api/assets/a1');
    expect(calls[0]?.url).toBe(
      'https://openroom.test/api/tutoring/spaces/space-1/assets?name=gare.jpg&alt=A+station',
    );
    expect(calls[0]?.headers?.['content-type']).toBe('image/jpeg');
    expect(calls[0]?.body).toBe(bytes);
  });

  it('lists a space’s media library and passes a search query through', async () => {
    const { fetch, calls } = recorder(() => ({ status: 200, body: { assets: [] } }));
    const client = createDeckClient({ baseUrl: 'https://openroom.test', fetch });
    expect(await client.assets.list('space-1', 'gare')).toEqual([]);
    expect(calls[0]?.url).toBe(
      'https://openroom.test/api/tutoring/spaces/space-1/assets?query=gare',
    );
    await client.assets.list('space-1');
    expect(calls[1]?.url).toBe('https://openroom.test/api/tutoring/spaces/space-1/assets');
  });
});
