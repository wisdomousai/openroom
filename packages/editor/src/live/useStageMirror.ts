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
 */
export function useStageMirror(live: StoredSession) {
  const { fetchStageToken, sessions } = useEditorServices().live;
  const [stageToken, setStageToken] = useState(live.stageToken);
  const [attempt, setAttempt] = useState(0);
  const [stageSnapshot, setStageSnapshot] = useState<StageSnapshot | null>(null);
  const [stageStatus, setStageStatus] = useState<StageConnectionStatus>('connecting');
  const clientRef = useRef<SessionClient<StageSnapshot> | null>(null);

  useEffect(() => {
    if (stageToken) return;
    let cancelled = false;
    fetchStageToken(live.sessionCode, live.hostToken)
      .then((token) => {
        if (cancelled) return;
        setStageToken(token);
        sessions.save({ ...live, stageToken: token });
      })
      .catch(() => {
        /* the Stage item shows a retry */
      });
    return () => {
      cancelled = true;
    };
    // `live` is part of the contract: a replaced session row re-runs the probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageToken, live, attempt]);

  useEffect(() => {
    if (!stageToken) return;
    const client = createSessionClient<StageSnapshot>({
      baseUrl: '',
      sessionCode: live.sessionCode,
      token: stageToken,
      role: 'stage',
      onChange: setStageSnapshot,
      onStatus: setStageStatus,
    });
    clientRef.current = client;
    return () => {
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [live.sessionCode, stageToken]);

  const retryStageToken = useCallback(() => setAttempt((n) => n + 1), []);
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

  return { stageToken, stageSnapshot, stageStatus, retryStageToken, refreshStage };
}
