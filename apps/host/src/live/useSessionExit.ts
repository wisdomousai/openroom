import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchSessionContext, getSessionItem, type SessionContext } from '../api';
import { handOffLiveNotes } from '../lib/scratchpad';
import { clearLiveSession } from '../storage';
import type { StoredSession } from '../types';
import { shouldHandOffNotes, type ProbeState } from './session-exit';

/** The deck's own place in the Library, once the session's row has been read. */
export interface DeckPlace {
  spaceId: string;
  folderId: string | null;
  itemId: string;
}

export interface SessionExit {
  /** `undefined` while the probe is in flight or has failed; else the payload. */
  context: SessionContext | null | undefined;
  probe: ProbeState;
  probeFailed: boolean;
  retryProbe: () => void;
  /** The durable session id, when this session has one. */
  sessionId: string | null;
  deckPlace: DeckPlace | null;
  /** Owner or editor of the session's space; false until known and without a durable session. */
  canEdit: boolean;
}

/**
 * The context probe and the end-of-session hand-off, shared by every live
 * surface (console, presenter remote, Q&A desk).
 *
 * Two reads. The first says what the session was launched for and gives the
 * durable session id; the second turns that id into the deck's place in the
 * Library, so the exit lands on the deck rather than at the library root.
 *
 * A failed probe is kept distinct from "no context". The console must not treat
 * an unreachable server as a session with nothing to write: the hand-off would
 * then drop the tutor's scratchpad.
 */
export function useSessionExit(live: StoredSession, ended: boolean): SessionExit {
  const [context, setContext] = useState<SessionContext | null | undefined>(undefined);
  const [probeFailed, setProbeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [deckPlace, setDeckPlace] = useState<DeckPlace | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const retryProbe = useCallback(() => {
    setProbeFailed(false);
    setContext(undefined);
    setAttempt((n) => n + 1);
  }, []);

  const { sessionCode, hostToken } = live;

  useEffect(() => {
    let cancelled = false;
    fetchSessionContext(sessionCode, hostToken)
      .then((value) => {
        if (cancelled) return;
        setContext(value);
        setProbeFailed(false);
      })
      .catch(() => {
        /*
         * Not swallowed to `null`: a session we could not read is not a session
         * with nothing to write. The surface offers Retry instead.
         */
        if (!cancelled) setProbeFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionCode, hostToken, attempt]);

  /** One automatic retry at the moment the session ends — that is when it matters. */
  const retriedOnEnd = useRef(false);
  useEffect(() => {
    if (!ended || !probeFailed || retriedOnEnd.current) return;
    retriedOnEnd.current = true;
    retryProbe();
  }, [ended, probeFailed, retryProbe]);

  const sessionId = context?.session?.id ?? null;

  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    getSessionItem(sessionId)
      .then(({ session, canEdit: editable }) => {
        if (cancelled) return;
        setCanEdit(editable);
        setDeckPlace({
          spaceId: session.spaceId,
          folderId: session.folderId,
          itemId: session.deckId,
        });
      })
      .catch(() => {
        /* a co-host who is not a member of the space reads no row: fall back to the Library root */
        if (cancelled) return;
        setDeckPlace(null);
        setCanEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const probe: ProbeState = probeFailed
    ? { state: 'failed' }
    : context === undefined
      ? { state: 'pending' }
      : { state: 'resolved', sessionId };

  const handedOff = useRef(false);
  useEffect(() => {
    if (handedOff.current || !shouldHandOffNotes({ ended, probe })) return;
    handedOff.current = true;
    // The durable id is known now, so the live-keyed copy can be re-keyed and
    // the spent credentials dropped from this device.
    handOffLiveNotes(sessionCode, sessionId);
    clearLiveSession(sessionCode);
  }, [ended, probe, sessionCode, sessionId]);

  return { context, probe, probeFailed, retryProbe, sessionId, deckPlace, canEdit };
}
