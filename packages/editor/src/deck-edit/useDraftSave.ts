/**
 * Hybrid save for the deck editor.
 *
 * Two different promises, kept apart on purpose:
 *
 *   * **The draft** is continuous and machine-made. It follows the editor a
 *     second and a half behind and is never validated, so half-typed YAML
 *     still survives a closed tab. Nothing launches a session from it.
 *   * **The version** is explicit and human-made. It is validated, numbered,
 *     and immutable — the thing a session is delivered from. Stamping one clears
 *     the draft server-side, because the work it was holding is now saved.
 *
 * The status this exports is deliberately literal: it says "Saved" only after
 * the server has acknowledged the write, never on the optimistic hope that it
 * will. A save indicator that lies is worse than none, because the tutor stops
 * checking. The state machine lives in `createDraftSaver` — a plain object with
 * injected timers and transport, so it can be tested without a DOM.
 */
import { useEffect, useRef, useState } from 'react';

import { isServiceError, useEditorServices } from '../services';

export type DraftSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Why the saver stopped: the server refused the write for a cause a retry
 * cannot fix (deck in Trash, sign-in ended, role changed, deck too large).
 */
export interface DraftStopReason {
  /** The server's code, such as `resource-in-trash`; the HTTP status as text when it named none. */
  code: string;
  status: number;
  /** The sentence the transport built for this refusal. */
  message: string;
}

export interface DraftStatus {
  state: DraftSaveState;
  /** Server ack time of the last successful draft write, if any. */
  savedAt: number | null;
  /** True while an errored save still has retries left. */
  retrying: boolean;
  /** Ready-to-render sentence; '' when there is nothing to say. */
  label: string;
  /**
   * Set with state `error` when the saver stopped on a refusal. Saving waits
   * for `retry()` or a stamped version. Absent means no reason to show.
   */
  reason?: DraftStopReason;
}

export const DRAFT_DEBOUNCE_MS = 1_500;
/** Retries after the first failure. Exhausting them leaves the state at error. */
export const DRAFT_RETRY_DELAYS_MS = [1_000, 4_000, 10_000] as const;

export function draftStatusLabel(
  state: DraftSaveState,
  _savedAt: number | null,
  retrying: boolean,
): string {
  if (state === 'dirty') return 'Unsaved changes';
  if (state === 'saving') return 'Saving…';
  if (state === 'saved') return 'Saved';
  if (state === 'error') return retrying ? 'Couldn’t save — retrying' : 'Couldn’t save';
  return '';
}

export const IDLE_STATUS: DraftStatus = {
  state: 'idle',
  savedAt: null,
  retrying: false,
  label: '',
};

export interface DraftSaver {
  /** The editor text changed (or the base version moved). */
  change(source: string, baseVersion: number): void;
  /**
   * A version was stamped: the server dropped the draft, so this text is the
   * new baseline and there is nothing outstanding to report.
   */
  versionSaved(source: string, baseVersion: number): void;
  status(): DraftStatus;
  /** Send the current text now, after a stopped refusal (Try again, or after Restore). */
  retry(): void;
  /** Cancel timers. A pending edit is flushed best-effort so a navigation
   *  away does not silently drop the last second of typing. */
  dispose(): void;
}

export interface DraftSaverOptions {
  /** Resolves with the server's ack time. */
  put: (source: string, baseVersion: number) => Promise<{ savedAt: number }>;
  /** Text already on the server when the editor opened — never re-sent. */
  acked: string;
  onStatus: (status: DraftStatus) => void;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  /**
   * The server refused the write because the deck moved on elsewhere
   * (409 version-conflict). Retrying the same base cannot succeed, so the
   * saver stops and hands the conflict to the host instead of counting down
   * retries.
   */
  onConflict?: (error: unknown) => void;
}

/** True when a draft write was refused because the deck changed elsewhere. */
export function isDraftConflict(error: unknown): boolean {
  return (
    isServiceError(error) &&
    error.status === 409 &&
    (error.code === undefined || error.code === 'version-conflict')
  );
}

export type DraftFailure =
  | { kind: 'retry' }
  | { kind: 'conflict' }
  | { kind: 'stop'; reason: DraftStopReason };

/**
 * What a failed draft write means for the saver. Only a failure that can pass
 * on its own retries: no answer (status 0), rate limiting (429) or a server
 * fault (5xx). A version conflict goes to the host's conflict choice. Every
 * other refusal stops with the server's reason, because sending the same
 * write again gets the same answer.
 */
export function classifyDraftFailure(error: unknown): DraftFailure {
  if (!isServiceError(error)) return { kind: 'retry' };
  const { status } = error;
  if (status === 0 || status === 429 || status >= 500) return { kind: 'retry' };
  if (isDraftConflict(error)) return { kind: 'conflict' };
  return { kind: 'stop', reason: { code: error.code ?? String(status), status, message: error.message } };
}

export function createDraftSaver(options: DraftSaverOptions): DraftSaver {
  const debounceMs = options.debounceMs ?? DRAFT_DEBOUNCE_MS;
  const retryDelays = options.retryDelaysMs ?? DRAFT_RETRY_DELAYS_MS;

  let acked = options.acked;
  let current = options.acked;
  let baseVersion = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let attempt = 0;
  let disposed = false;
  /** Set by a 409: the same base can only be refused again. */
  let conflicted = false;
  /** Set by a refusal a retry cannot fix; cleared by retry() or a stamped version. */
  let stopped: DraftStopReason | null = null;
  let status: DraftStatus = IDLE_STATUS;

  const emit = (
    state: DraftSaveState,
    savedAt: number | null,
    retrying: boolean,
    reason: DraftStopReason | null = null,
  ): void => {
    // Every keystroke re-enters 'dirty'; re-announcing it would re-render the
    // console for a status that has not changed.
    if (
      status.state === state &&
      status.savedAt === savedAt &&
      status.retrying === retrying &&
      (status.reason?.code ?? null) === (reason?.code ?? null)
    ) {
      return;
    }
    status = {
      state,
      savedAt,
      retrying,
      label: draftStatusLabel(state, savedAt, retrying),
      ...(reason === null ? {} : { reason }),
    };
    options.onStatus(status);
  };

  const cancelTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number): void => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const flush = async (): Promise<void> => {
    if (disposed || inFlight || stopped !== null) return;
    // Nothing to send: the text came back to what the server already holds.
    if (current === acked) return;
    const sending = current;
    const sendingBase = baseVersion;
    inFlight = true;
    emit('saving', status.savedAt, false);
    try {
      const result = await options.put(sending, sendingBase);
      inFlight = false;
      if (disposed) return;
      acked = sending;
      attempt = 0;
      emit('saved', result.savedAt, false);
      // Typed on while the request was in flight — that text is still unsaved.
      if (current !== acked) {
        emit('dirty', status.savedAt, false);
        schedule(debounceMs);
      }
    } catch (error) {
      inFlight = false;
      if (disposed) return;
      const failure = classifyDraftFailure(error);
      if (failure.kind === 'conflict' && options.onConflict !== undefined) {
        attempt = 0;
        conflicted = true;
        emit('error', status.savedAt, false, {
          code: 'version-conflict',
          status: 409,
          message: error instanceof Error ? error.message : 'This deck was saved somewhere else.',
        });
        options.onConflict(error);
        return;
      }
      if (failure.kind !== 'retry') {
        cancelTimer();
        attempt = 0;
        stopped =
          failure.kind === 'stop'
            ? failure.reason
            : { code: 'version-conflict', status: 409, message: error instanceof Error ? error.message : '' };
        emit('error', status.savedAt, false, stopped);
        return;
      }
      const delay = retryDelays[attempt];
      attempt += 1;
      if (delay === undefined) {
        // Out of retries: stay visibly failed rather than pretend, and wait
        // for the next edit to try again.
        emit('error', status.savedAt, false);
        return;
      }
      emit('error', status.savedAt, true);
      schedule(delay);
    }
  };

  return {
    change(source: string, nextBaseVersion: number): void {
      if (disposed) return;
      current = source;
      baseVersion = nextBaseVersion;
      // Stopped on a refusal: keep the text and the reason, send nothing until retry().
      if (stopped !== null) return;
      if (source === acked) {
        // An edit undone. Cancel the pending write instead of sending a no-op.
        cancelTimer();
        if (status.state === 'dirty' || status.state === 'error') {
          attempt = 0;
          emit(status.savedAt === null ? 'idle' : 'saved', status.savedAt, false);
        }
        return;
      }
      attempt = 0;
      if (status.state !== 'saving') emit('dirty', status.savedAt, false);
      schedule(debounceMs);
    },
    versionSaved(source: string, nextBaseVersion: number): void {
      if (disposed) return;
      cancelTimer();
      acked = source;
      current = source;
      baseVersion = nextBaseVersion;
      attempt = 0;
      stopped = null;
      emit('idle', null, false);
    },
    status(): DraftStatus {
      return status;
    },
    retry(): void {
      if (disposed || stopped === null) return;
      stopped = null;
      attempt = 0;
      cancelTimer();
      if (current === acked) {
        emit(status.savedAt === null ? 'idle' : 'saved', status.savedAt, false);
        return;
      }
      void flush();
    },
    dispose(): void {
      cancelTimer();
      if (!disposed && !inFlight && !conflicted && stopped === null && current !== acked) {
        void options.put(current, baseVersion).catch(() => undefined);
      }
      disposed = true;
    },
  };
}

export interface DraftSaveHandle {
  status: DraftStatus;
  /** Call after a successful `addDeckVersion`: the server cleared the draft. */
  versionSaved: (source: string, baseVersion: number) => void;
  /** Send the current text again after a stopped refusal. */
  retry: () => void;
}

/**
 * React binding. `enabled` stays false until the document is loaded, so the
 * seeding of the editor from the server is never mistaken for an edit.
 * Writes go through the `drafts` slot; without it the status stays idle.
 */
export function useDraftSave(options: {
  deckId: string;
  source: string;
  baseVersion: number;
  enabled: boolean;
  /** A write was refused with 409 version-conflict: the host shows its conflict choice. */
  onConflict?: () => void;
}): DraftSaveHandle {
  const { deckId, source, baseVersion, enabled } = options;
  const onConflictRef = useRef(options.onConflict);
  onConflictRef.current = options.onConflict;
  const [status, setStatus] = useState<DraftStatus>(IDLE_STATUS);
  const [observedSource, setObservedSource] = useState(source);
  const saverRef = useRef<DraftSaver | null>(null);
  // The first source seen for a deck is the baseline, not an edit: track it
  // until a saver exists, then leave it alone.
  const seedRef = useRef({ deckId, source });
  if (saverRef.current === null || seedRef.current.deckId !== deckId) {
    seedRef.current = { deckId, source };
  }

  const drafts = useEditorServices().slots.drafts;

  useEffect(() => {
    if (!enabled || drafts === undefined) return undefined;
    const saver = createDraftSaver({
      acked: seedRef.current.source,
      put: (text, base) => drafts.save(deckId, text, base),
      onStatus: setStatus,
      onConflict: () => onConflictRef.current?.(),
    });
    saverRef.current = saver;
    setStatus(IDLE_STATUS);
    return () => {
      saver.dispose();
      saverRef.current = null;
    };
    // Seeding is intentionally read once, at creation, from the ref.
  }, [deckId, drafts, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setObservedSource(source);
    saverRef.current?.change(source, baseVersion);
  }, [source, baseVersion, enabled]);

  return {
    // New text can render before the effect advances the saver. Never show the
    // previous text's Saved acknowledgement on that intervening render.
    // A stopped save keeps its reason while the tutor types on.
    status: enabled && source !== observedSource && status.reason === undefined
      ? { ...status, state: 'dirty' as const, label: draftStatusLabel('dirty', null, false), retrying: false }
      : status,
    versionSaved: (text: string, version: number) => {
      saverRef.current?.versionSaved(text, version);
    },
    retry: () => {
      saverRef.current?.retry();
    },
  };
}
