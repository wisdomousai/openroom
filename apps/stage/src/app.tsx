import { useEffect, useMemo, useState } from 'react';
import { createSessionClient, type ConnectionStatus, type StageSnapshot } from '@openroom/sdk';
import { StageView } from './StageView';

function readParams(): { sessionCode: string | null; token: string | null } {
  const p = new URLSearchParams(location.search);
  return { sessionCode: p.get('session'), token: p.get('token') };
}

export function App() {
  const { sessionCode, token: stageToken } = useMemo(readParams, []);
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  /** The server refused this stage link for good: its token expired, or the session is gone. */
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!sessionCode || !stageToken) return;
    const client = createSessionClient<StageSnapshot>({
      baseUrl: '',
      sessionCode,
      token: stageToken,
      role: 'stage',
      onChange: setSnapshot,
      onStatus: setStatus,
      onGone: () => setGone(true),
    });
    return () => client.close();
  }, [sessionCode, stageToken]);

  if (!sessionCode || !stageToken) {
    return (
      <div className="stage stage--bare">
        <div className="center">
          <p className="center__big">Stage view</p>
          <p className="center__sub">
            Missing <code>?session=CODE&amp;token=…</code> — the link comes from the host console.
          </p>
        </div>
      </div>
    );
  }

  // An ended session keeps saying so after its storage is wiped.
  if (gone && snapshot?.status !== 'ended') {
    return (
      <div className="stage stage--bare">
        <div className="center">
          <p className="center__big">This stage link no longer works.</p>
          <p className="center__sub">Open the stage again from the Session menu in the host console.</p>
        </div>
      </div>
    );
  }

  return <StageView snapshot={snapshot} status={status} />;
}
