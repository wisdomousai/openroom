/**
 * The scratchpad in Desktop's file window: same keys as the workspace, handed
 * to the Notes form only when the build ships the workspace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLiveNotes, readSessionNotes, writeLiveNotes } from '@openroom/editor';
import { probeWorkspace } from './destinations';
import { handOffScratchpad } from './scratchpad';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await probeWorkspace(() => Promise.reject(new Error('reset')));
});

describe('handOffScratchpad', () => {
  it('keeps the workspace keys, so either window reads the same notes', () => {
    writeLiveNotes('ABC123', 'past perfect');
    expect(store.get('openroom.host.notes.live.ABC123')).toBe('past perfect');
  });

  it('re-keys the notes for the Notes form when the workspace is present', async () => {
    await probeWorkspace(() => Promise.resolve(new Response(null, { status: 200 })));
    writeLiveNotes('ABC123', 'past perfect');
    handOffScratchpad('ABC123', 'ses_1');
    expect(readLiveNotes('ABC123')).toBe('');
    expect(readSessionNotes('ses_1')).toBe('past perfect');
    expect(store.get('openroom.host.notes.session.ses_1')).toBe('past perfect');
  });

  it('clears the live notes without a workspace, leaving no record-keyed copy', async () => {
    await probeWorkspace(() => Promise.resolve(new Response(null, { status: 404 })));
    writeLiveNotes('ABC123', 'past perfect');
    handOffScratchpad('ABC123', 'ses_1');
    expect(readLiveNotes('ABC123')).toBe('');
    expect(readSessionNotes('ses_1')).toBe('');
  });
});
