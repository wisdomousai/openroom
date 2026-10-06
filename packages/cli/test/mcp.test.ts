import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { callTool, multiplexToolDeps, unavailableHostedDeps } from '@openroom/mcp';
import { stringifyOpenRoomFile, type OpenRoomFileV1 } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import { loadOpenRoomBinding } from '../src/mcp-file.js';
import { takeHeadlessLock, writeLock } from '../src/mcp-lock.js';
import { readOpenRoomArchive, writeOpenRoomArchive } from '../src/openroom-zip.js';

const envelope: OpenRoomFileV1 = {
  format: 'openroom-file',
  fileVersion: 1,
  fileId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  localRevision: 1,
  outline: {
    version: 1,
    meta: { title: 'Desk deck' },
    steps: [
      { id: 'welcome', kind: 'title', title: 'Hello' },
      { id: 'check', kind: 'interaction', interactionId: 'check' },
    ],
    interactions: [
      {
        id: 'check',
        type: 'choice',
        prompt: 'Ready?',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      },
    ],
  },
};

describe('headless file MCP', () => {
  it('reads and stamps a .openroom through the same design tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openroom-mcp-'));
    const path = join(dir, 'french-b1.openroom');
    writeOpenRoomArchive(path, new Map([['deck.yaml', Buffer.from(stringifyOpenRoomFile(envelope))]]));
    const deps = multiplexToolDeps(unavailableHostedDeps(), loadOpenRoomBinding(path));
    return callTool(deps, 'deck_get', { deckId: envelope.fileId }).then(async (got) => {
      expect(got).toEqual(expect.objectContaining({ ok: true }));
      const saved = await callTool(deps, 'deck_save_version', {
        deckId: envelope.fileId,
        content: {
          ...envelope.outline,
          meta: { title: 'Renamed' },
        },
        baseVersion: 1,
      });
      expect(saved).toEqual(expect.objectContaining({ ok: true }));
      const text = readOpenRoomArchive(path).get('deck.yaml')!.toString('utf8');
      expect(text).toContain('Renamed');
      expect(text).toContain('localRevision: 2');
    });
  });

  it('refuses a write when desktop holds the lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openroom-mcp-'));
    const path = join(dir, 'french-b1.openroom');
    writeOpenRoomArchive(path, new Map([['deck.yaml', Buffer.from(stringifyOpenRoomFile(envelope))]]));
    writeLock(path, { fileId: envelope.fileId, pid: process.pid, host: 'desktop' });
    const deps = multiplexToolDeps(unavailableHostedDeps(), loadOpenRoomBinding(path));
    const saved = await callTool(deps, 'deck_save_version', {
      deckId: envelope.fileId,
      content: { ...envelope.outline, meta: { title: 'Nope' } },
      baseVersion: 1,
    });
    expect(saved).toEqual(expect.objectContaining({ ok: false }));
  });

  it('takes a headless lock and does not invent a token flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openroom-mcp-'));
    const path = join(dir, 'french-b1.openroom');
    writeOpenRoomArchive(path, new Map([['deck.yaml', Buffer.from(stringifyOpenRoomFile(envelope))]]));
    expect(takeHeadlessLock(path, envelope.fileId)).toEqual({ ok: true });
    expect(takeHeadlessLock(path, envelope.fileId)).toEqual({ ok: true });
  });
});
