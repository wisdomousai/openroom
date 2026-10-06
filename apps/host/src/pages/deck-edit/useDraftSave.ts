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

import { invalidateManagementData } from '../../query-client';
import { putDeckDraft } from '../../api';

export type DraftSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface DraftStatus {
  state: DraftSaveState;
  /** Server ack time of the last successful draft write, if any. */
  savedAt: number | null;
  /** True while an errored save still has retries left. */
  retrying: boolean;
  /** Ready-to-render sentence; '' when there is nothing to say. */
  label: string;
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
  let status: DraftStatus = IDLE_STATUS;

  const emit = (state: DraftSaveState, savedAt: number | null, retrying: boolean): void => {
    // Every keystroke re-enters 'dirty'; re-announcing it would re-render the
    // console for a status that has not changed.
    if (status.state === state && status.savedAt === savedAt && status.retrying === retrying) return;
    status = { state, savedAt, retrying, label: draftStatusLabel(state, savedAt, retrying) };
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
    if (disposed || inFlight) return;
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
    } catch {
      inFlight = false;
      if (disposed) return;
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
      emit('idle', null, false);
    },
    status(): DraftStatus {
      return status;
    },
    dispose(): void {
      cancelTimer();
      if (!disposed && !inFlight && current !== acked) {
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
}

/**
 * React binding. `enabled` stays false until the document is loaded, so the
 * seeding of the editor from the server is never mistaken for an edit.
 */
export function useDraftSave(options: {
  deckId: string;
  source: string;
  baseVersion: number;
  enabled: boolean;
}): DraftSaveHandle {
  const { deckId, source, baseVersion, enabled } = options;
  const [status, setStatus] = useState<DraftStatus>(IDLE_STATUS);
  const [observedSource, setObservedSource] = useState(source);
  const saverRef = useRef<DraftSaver | null>(null);
  // The first source seen for a deck is the baseline, not an edit: track it
  // until a saver exists, then leave it alone.
  const seedRef = useRef({ deckId, source });
  if (saverRef.current === null || seedRef.current.deckId !== deckId) {
    seedRef.current = { deckId, source };
  }

  useEffect(() => {
    if (!enabled) return undefined;
    const saver = createDraftSaver({
      acked: seedRef.current.source,
      put: async (text, base) => { const result = await putDeckDraft(deckId, text, base); void invalidateManagementData(); return result; },
      onStatus: setStatus,
    });
    saverRef.current = saver;
    setStatus(IDLE_STATUS);
    return () => {
      saver.dispose();
      saverRef.current = null;
    };
    // Seeding is intentionally read once, at creation, from the ref.
  }, [deckId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setObservedSource(source);
    saverRef.current?.change(source, baseVersion);
  }, [source, baseVersion, enabled]);

  return {
    // New text can render before the effect advances the saver. Never show the
    // previous text's Saved acknowledgement on that intervening render.
    status: enabled && source !== observedSource
      ? { ...status, state: 'dirty' as const, label: draftStatusLabel('dirty', null, false), retrying: false }
      : status,
    versionSaved: (text: string, version: number) => {
      saverRef.current?.versionSaved(text, version);
    },
  };
}
