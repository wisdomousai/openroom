/**
 * What a live surface does when its session ends.
 *
 * The policy is a pure function so it can be read and tested on its own: the
 * console, the presenter remote and the Q&A desk all take the same exit, and
 * the one rule that must never bend is the scratchpad rule — a session whose
 * context probe has not resolved hands off nothing, because handing off to a
 * null session id deletes the tutor's private notes (./scratchpad.ts).
 */

/** Where the probe for the durable session stands. */
export type ProbeState =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'resolved'; sessionId: string | null };

export type ExitDecision =
  /** The session is still running: the surface renders itself. */
  | { kind: 'none' }
  /** Ended, waiting on the probe (or on the desktop shell). Show "Opening notes…". */
  | { kind: 'wait' }
  /** The probe failed. Offer Retry and Library; hand off nothing. */
  | { kind: 'retry' }
  /** The desktop document window keeps its own ended row (Export + Back to deck). */
  | { kind: 'desktop-ended' }
  | { kind: 'notes'; sessionId: string }
  | { kind: 'library' };

export interface ExitInput {
  ended: boolean;
  /** `null` until the desktop shell answers whether this window holds a document. */
  documentWindow: boolean | null;
  probe: ProbeState;
}

export function resolveEndedExit({ ended, documentWindow, probe }: ExitInput): ExitDecision {
  if (!ended) return { kind: 'none' };
  // The desktop document window is the one surviving post-end surface: an
  // outline session has no durable row, so there is no Notes page to open.
  if (documentWindow === null) return { kind: 'wait' };
  if (documentWindow) return { kind: 'desktop-ended' };
  if (probe.state === 'pending') return { kind: 'wait' };
  if (probe.state === 'failed') return { kind: 'retry' };
  if (probe.sessionId !== null) return { kind: 'notes', sessionId: probe.sessionId };
  return { kind: 'library' };
}

/**
 * Whether the live-keyed scratchpad may be moved to its durable key.
 *
 * Only once the probe has resolved. A failed or in-flight probe hands off
 * nothing: `handOffLiveNotes(code, null)` drops the text, and losing what the
 * tutor typed is worse than leaving it keyed to a spent join code.
 */
export function shouldHandOffNotes({ ended, probe }: { ended: boolean; probe: ProbeState }): boolean {
  return ended && probe.state === 'resolved';
}
