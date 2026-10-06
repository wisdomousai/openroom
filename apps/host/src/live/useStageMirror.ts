import { useCallback, useEffect, useState } from 'react';
import {
  createSessionClient,
  type ConnectionStatus as StageConnectionStatus,
  type StageSnapshot,
} from '@openroom/sdk';

import { fetchStageToken } from '../api';
import { saveLiveSession } from '../storage';
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
  const [stageToken, setStageToken] = useState(live.stageToken);
  const [attempt, setAttempt] = useState(0);
  const [stageSnapshot, setStageSnapshot] = useState<StageSnapshot | null>(null);
  const [stageStatus, setStageStatus] = useState<StageConnectionStatus>('connecting');

  useEffect(() => {
    if (stageToken) return;
    let cancelled = false;
    fetchStageToken(live.sessionCode, live.hostToken)
      .then((token) => {
        if (cancelled) return;
        setStageToken(token);
        saveLiveSession({ ...live, stageToken: token });
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
    return () => client.close();
  }, [live.sessionCode, stageToken]);

  const retryStageToken = useCallback(() => setAttempt((n) => n + 1), []);

  return { stageToken, stageSnapshot, stageStatus, retryStageToken };
}
