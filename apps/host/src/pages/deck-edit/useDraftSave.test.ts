/**
 * The draft state machine behind hybrid save.
 *
 * The contract under test is honesty: "Saved" appears only after the server
 * has acknowledged the write, an undone edit is not sent, and a failing save
 * says so instead of quietly settling into a saved-looking state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDraftSaver, draftStatusLabel, type DraftStatus } from './useDraftSave';

function harness(put: (source: string, baseVersion: number) => Promise<{ savedAt: number }>) {
  const seen: DraftStatus[] = [];
  const saver = createDraftSaver({
    acked: 'seed',
    put,
    onStatus: (status) => seen.push(status),
    debounceMs: 1_500,
    retryDelaysMs: [1_000, 4_000],
  });
  return { saver, seen, states: () => seen.map((s) => s.state) };
}

describe('draft save state machine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces, and only reports Saved once the server has acked', async () => {
    const put = vi.fn(async () => ({ savedAt: Date.UTC(2026, 7, 11, 9, 30) }));
    const { saver, states } = harness(put);

    saver.change('one', 3);
    saver.change('one two', 3);
    expect(saver.status().label).toBe('Unsaved changes');

    await vi.advanceTimersByTimeAsync(1_499);
    expect(put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    // One write for two keystrokes, carrying the latest text and base version.
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('one two', 3);
    expect(states()).toEqual(['dirty', 'saving', 'saved']);
    expect(saver.status().label).toBe('Saved');
    saver.dispose();
  });

  it('does not write text the server already holds', async () => {
    const put = vi.fn(async () => ({ savedAt: 1 }));
    const { saver } = harness(put);

    saver.change('typed', 1);
    saver.change('seed', 1); // undone before the debounce elapsed
    await vi.advanceTimersByTimeAsync(5_000);
    expect(put).not.toHaveBeenCalled();
    expect(saver.status().state).toBe('idle');
    saver.dispose();
  });

  it('retries with backoff, then stays failed until the next edit', async () => {
    const put = vi.fn(async () => { throw new Error('offline'); });
    const { saver, states } = harness(put);

    saver.change('a', 1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(saver.status().label).toBe('Couldn’t save — retrying');

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(put).toHaveBeenCalledTimes(3);
    // Retries exhausted: stop promising a retry that will not come.
    expect(saver.status().state).toBe('error');
    expect(saver.status().label).toBe('Couldn’t save');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(put).toHaveBeenCalledTimes(3);

    saver.change('b', 1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(put).toHaveBeenCalledTimes(4);
    expect(states()).toContain('dirty');
    saver.dispose();
  });

  it('keeps typing during a slow save and writes the newer text after', async () => {
    let release: ((value: { savedAt: number }) => void) | null = null;
    const put = vi.fn(() => new Promise<{ savedAt: number }>((resolve) => { release = resolve; }));
    const { saver } = harness(put);

    saver.change('first', 1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(saver.status().state).toBe('saving');
    saver.change('first second', 1);
    release!({ savedAt: 10 });
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.status().state).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(put).toHaveBeenLastCalledWith('first second', 1);
    saver.dispose();
  });

  it('a stamped version becomes the new baseline with nothing outstanding', async () => {
    const put = vi.fn(async () => ({ savedAt: 1 }));
    const { saver } = harness(put);

    saver.change('edited', 1);
    saver.versionSaved('edited', 2);
    await vi.advanceTimersByTimeAsync(5_000);
    // The server dropped the draft when it stamped; re-sending it would only
    // resurrect work that is already safely versioned.
    expect(put).not.toHaveBeenCalled();
    expect(saver.status().label).toBe('');
    saver.dispose();
  });

  it('flushes a pending edit on dispose rather than losing the last keystrokes', async () => {
    const put = vi.fn(async () => ({ savedAt: 1 }));
    const { saver } = harness(put);
    saver.change('unflushed', 4);
    saver.dispose();
    expect(put).toHaveBeenCalledWith('unflushed', 4);
  });

  it('labels every state in the tutor’s words', () => {
    expect(draftStatusLabel('idle', null, false)).toBe('');
    expect(draftStatusLabel('dirty', null, false)).toBe('Unsaved changes');
    expect(draftStatusLabel('saving', null, false)).toBe('Saving…');
    expect(draftStatusLabel('error', null, true)).toBe('Couldn’t save — retrying');
    const at = new Date(2026, 7, 11, 9, 5).getTime();
    expect(draftStatusLabel('saved', at, false)).toBe('Saved');
  });
});
