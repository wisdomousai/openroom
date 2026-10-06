import { describe, expect, it } from 'vitest';

import { resolveEndedExit, shouldHandOffNotes, type ProbeState } from './session-exit';

const pending: ProbeState = { state: 'pending' };
const failed: ProbeState = { state: 'failed' };
const resolved = (sessionId: string | null): ProbeState => ({ state: 'resolved', sessionId });

describe('resolveEndedExit', () => {
  it('leaves a running session alone', () => {
    expect(resolveEndedExit({ ended: false, documentWindow: false, probe: resolved('s1') })).toEqual({
      kind: 'none',
    });
  });

  it('waits while the probe is in flight rather than guessing', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: false, probe: pending })).toEqual({
      kind: 'wait',
    });
  });

  it('waits while the desktop shell has not said which window this is', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: null, probe: resolved('s1') })).toEqual({
      kind: 'wait',
    });
  });

  it('opens the notes of the session that just ended', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: false, probe: resolved('s1') })).toEqual({
      kind: 'notes',
      sessionId: 's1',
    });
  });

  it('falls back to the Library when there is no durable session to write about', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: false, probe: resolved(null) })).toEqual({
      kind: 'library',
    });
  });

  it('offers a retry instead of an exit when the probe failed', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: false, probe: failed })).toEqual({
      kind: 'retry',
    });
  });

  it('keeps the desktop document window on its own ended row', () => {
    expect(resolveEndedExit({ ended: true, documentWindow: true, probe: resolved(null) })).toEqual({
      kind: 'desktop-ended',
    });
    expect(resolveEndedExit({ ended: true, documentWindow: true, probe: failed })).toEqual({
      kind: 'desktop-ended',
    });
  });
});

describe('scratchpad hand-off', () => {
  it('never hands off before the probe resolves — a null id deletes the notes', () => {
    expect(shouldHandOffNotes({ ended: true, probe: pending })).toBe(false);
    expect(shouldHandOffNotes({ ended: true, probe: failed })).toBe(false);
  });

  it('hands off once the durable id is known, and only after the session ends', () => {
    expect(shouldHandOffNotes({ ended: false, probe: resolved('s1') })).toBe(false);
    expect(shouldHandOffNotes({ ended: true, probe: resolved('s1') })).toBe(true);
    // A session that genuinely has no context still resolves: the notes are
    // dropped deliberately, not because a request failed.
    expect(shouldHandOffNotes({ ended: true, probe: resolved(null) })).toBe(true);
  });
});
