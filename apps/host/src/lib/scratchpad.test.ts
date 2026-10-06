import { describe, expect, it, vi } from 'vitest';

import { shouldHandOffNotes, type ProbeState } from '@openroom/editor';

describe('the scratchpad survives a failed probe', () => {
  it('leaves the live-keyed notes in place when no hand-off is allowed', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const { handOffLiveNotes, readLiveNotes, writeLiveNotes } = await import('./scratchpad');

    writeLiveNotes('ABC123', 'she nailed the past perfect');
    const probe: ProbeState = { state: 'failed' };
    if (shouldHandOffNotes({ ended: true, probe })) handOffLiveNotes('ABC123', null);

    expect(readLiveNotes('ABC123')).toBe('she nailed the past perfect');
    vi.unstubAllGlobals();
  });
});
