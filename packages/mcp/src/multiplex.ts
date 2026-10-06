/**
 * One MCP process, two backends. Outline/deck tools hit the bound file when
 * `deckId === file.fileId`. Session tools and unbound deck ids go to hosted.
 * Starting a session is never local.
 */
import { compileOutline } from '@openroom/schema';

import type { FileBinding } from './file-binding.js';
import { isBoundFileId } from './file-binding.js';
import type { ToolDeps } from './tools.js';

const DECK = /^\/api\/decks\/([^/?]+)(?:\/(versions|draft))?(?:\?.*)?$/;
const LOCAL_ASSETS = /^\/api\/tutoring\/spaces\/local\/assets(?:\?.*)?$/;
const START_SESSION = /^\/api\/sessions$/;
const LAUNCH_SESSION = /^\/api\/sessions\/([^/?]+)\/launch(?:\?.*)?$/;

export function multiplexToolDeps(hosted: ToolDeps, file: FileBinding | null): ToolDeps {
  let lastLocalStart: { sessionId: string; live: Awaited<ReturnType<ToolDeps['createSession']>> } | null =
    null;

  return {
    appOrigin: hosted.appOrigin,
    createSession: (outline) => hosted.createSession(outline),
    getExport: (code) => hosted.getExport(code),
    sessionCommand: (code, command, options) => hosted.sessionCommand(code, command, options),
    async controlRequest(method, path, body) {
      if (file !== null) {
        const local = await handleLocal(file, hosted, method, path, body, {
          get last() {
            return lastLocalStart;
          },
          set last(value) {
            lastLocalStart = value;
          },
        });
        if (local !== null) return local;
      }
      return hosted.controlRequest(method, path, body);
    },
  };
}

interface LocalStartSlot {
  last: { sessionId: string; live: Awaited<ReturnType<ToolDeps['createSession']>> } | null;
}

async function handleLocal(
  file: FileBinding,
  hosted: ToolDeps,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  starts: LocalStartSlot,
): Promise<{ status: number; body: unknown } | null> {
  const deckMatch = DECK.exec(path);
  if (deckMatch !== null) {
    const deckId = decodeURIComponent(deckMatch[1] ?? '');
    if (!isBoundFileId(file, deckId)) return null;
    const leaf = deckMatch[2];
    if (method === 'GET' && leaf === undefined) return getDeck(file);
    if (method === 'POST' && leaf === 'versions') return saveDeck(file, body);
    if (method === 'PUT' && leaf === 'draft') return putDraft(file, body);
    return { status: 405, body: { error: 'method-not-allowed' } };
  }

  if (LOCAL_ASSETS.test(path) && method === 'POST') {
    return insertImage(file, body);
  }

  if (method === 'POST' && START_SESSION.test(path)) {
    const deckId = asRecord(body)['deckId'];
    if (typeof deckId !== 'string' || !isBoundFileId(file, deckId)) return null;
    const compiled = compileOutline(file.getOutline());
    if (!compiled.ok) return { status: 422, body: { error: 'invalid-content', errors: compiled.errors } };
    const live = await hosted.createSession(compiled.outline);
    const sessionId = `local:${file.fileId}`;
    starts.last = { sessionId, live };
    return {
      status: 201,
      body: { session: { id: sessionId, deckId: file.fileId, title: file.title } },
    };
  }

  const launch = LAUNCH_SESSION.exec(path);
  if (launch !== null && method === 'POST') {
    const sessionId = decodeURIComponent(launch[1] ?? '');
    if (starts.last === null || starts.last.sessionId !== sessionId) return null;
    return {
      status: 201,
      body: {
        ...starts.last.live,
        sessionId,
        deckId: file.fileId,
        started: true,
      },
    };
  }

  return null;
}

function getDeck(file: FileBinding): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      deck: {
        id: file.fileId,
        title: file.title,
        currentVersion: file.localRevision,
      },
      contentVersion: file.localRevision,
      content: file.getOutline(),
    },
  };
}

function saveDeck(file: FileBinding, body: unknown): { status: number; body: unknown } {
  const record = asRecord(body);
  const baseVersion = record['baseVersion'];
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return { status: 422, body: { error: 'invalid-base-version' } };
  }
  const saved = file.saveOutline(record['content'], baseVersion);
  if (!saved.ok) {
    if ('conflict' in saved && saved.conflict) {
      return { status: 409, body: { error: 'version-conflict', latestVersion: saved.latestVersion } };
    }
    return { status: 422, body: { error: 'invalid-content', errors: 'errors' in saved ? saved.errors : [] } };
  }
  return { status: 200, body: { version: saved.version, unchanged: saved.unchanged === true } };
}

function putDraft(file: FileBinding, body: unknown): { status: number; body: unknown } {
  if (file.putDraft === undefined) return { status: 404, body: { error: 'not-found' } };
  const record = asRecord(body);
  const source = record['source'];
  const baseVersion = record['baseVersion'];
  if (typeof source !== 'string') return { status: 422, body: { error: 'invalid-source' } };
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) {
    return { status: 422, body: { error: 'invalid-base-version' } };
  }
  file.putDraft(source, baseVersion);
  return { status: 200, body: { savedAt: Date.now() } };
}

function insertImage(file: FileBinding, body: unknown): { status: number; body: unknown } {
  if (file.insertLocalImage === undefined) {
    return { status: 501, body: { error: 'local-media-unavailable' } };
  }
  const record = asRecord(body);
  const sourcePath = typeof record['path'] === 'string' ? record['path'] : '';
  if (sourcePath === '') return { status: 422, body: { error: 'invalid-path' } };
  const alt = typeof record['alt'] === 'string' ? record['alt'] : undefined;
  const inserted = file.insertLocalImage(sourcePath, alt);
  return { status: 201, body: inserted };
}

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}
