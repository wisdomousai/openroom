import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSessionClient,
  type SessionClient,
  type ConnectionStatus as StageConnectionStatus,
  type StageSnapshot,
} from '@openroom/sdk';

import { useEditorServices } from '../services';
import type { StoredSession } from '../types';

/**
 * The projector feed the console mirrors: fetch a stage token when the stored
 * session lacks one, then hold one stage-role session client.
 *
 * A failed fetch leaves the Stage menu item rendered but disabled with a
 * retry, never silently absent — a projector the host cannot reach from the
 * console is a dead path.
 *
 * When the server refuses the stage token for good, the mirror re-mints one
 * through the host token once. Only when that also fails is the preview
 * unavailable (`stageGone`), until the host retries from the Stage item.
 */
export function useStageMirror(live: StoredSession) {
  const { fetchStageToken, sessions } = useEditorServices().live;
  const [stageToken, setStageToken] = useState(live.stageToken);
  const [attempt, setAttempt] = useState(0);
  const [stageSnapshot, setStageSnapshot] = useState<StageSnapshot | null>(null);
  const [stageStatus, setStageStatus] = useState<StageConnectionStatus>('connecting');
  const [stageGone, setStageGone] = useState(false);
  /** The refused stage token has been re-minted once already. */
  const remintedRef = useRef(false);
  const clientRef = useRef<SessionClient<StageSnapshot> | null>(null);

  useEffect(() => {
    if (stageToken || stageGone) return;
    let cancelled = false;
    fetchStageToken(live.sessionCode, live.hostToken)
      .then((token) => {
        if (cancelled) return;
        setStageToken(token);
        sessions.save({ ...live, stageToken: token });
      })
      .catch(() => {
        // The Stage item shows a retry; after a refused token the preview says so.
        if (!cancelled && remintedRef.current) setStageGone(true);
      });
    return () => {
      cancelled = true;
    };
    // `live` is part of the contract: a replaced session row re-runs the probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageToken, stageGone, live, attempt]);

  useEffect(() => {
    if (!stageToken) return;
    const client = createSessionClient<StageSnapshot>({
      baseUrl: '',
      sessionCode: live.sessionCode,
      token: stageToken,
      role: 'stage',
      onChange: setStageSnapshot,
      onStatus: setStageStatus,
      onGone: () => {
        if (clientRef.current === client) clientRef.current = null;
        setStageToken('');
        if (remintedRef.current) setStageGone(true);
        remintedRef.current = true;
      },
    });
    clientRef.current = client;
    return () => {
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [live.sessionCode, stageToken]);

  const retryStageToken = useCallback(() => {
    setStageGone(false);
    setAttempt((n) => n + 1);
  }, []);
  const statusRef = useRef(stageStatus);
  statusRef.current = stageStatus;
  /**
   * Refetch the projector feed now, rather than on the client's next poll. A
   * live socket already pushes the change, so only a polling mirror refetches.
   */
  const refreshStage = useCallback(() => {
    if (statusRef.current === 'live') return;
    void clientRef.current?.refresh().catch(() => {
      /* the next poll or socket message brings it */
    });
  }, []);

  return { stageToken, stageSnapshot, stageStatus, stageGone, retryStageToken, refreshStage };
}
