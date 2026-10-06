import type { PresentationComposition } from '@openroom/schema';
import { useEffect } from 'react';
import { createSessionClient, type ConnectionStatus, type StageSnapshot } from '@openroom/sdk';
import type { SessionReference } from './bindings';
import { createDisplayPublisher } from './display-channel';

/** Fetch the real stage projection; never build audience data by subtracting fields from host state. */
export function useEmbeddedDisplay(grant: { sessionId: string; sessionCode: string; stageToken: string; presentation: PresentationComposition } | null, reference: SessionReference | null) {
  useEffect(() => {
    if (!grant || !reference || reference.sessionId !== grant.sessionId) return;
    const publisher = createDisplayPublisher(reference, grant.presentation);
    if (!publisher) return;
    let snapshot: StageSnapshot | null = null, status: ConnectionStatus = 'connecting';
    const client = createSessionClient<StageSnapshot>({
      sessionCode: grant.sessionCode, token: grant.stageToken, role: 'stage',
      onChange: (value) => { snapshot = value; publisher.update(value, status); },
      onStatus: (value) => { status = value; if (snapshot) publisher.update(snapshot, value); },
      fetch: (url, init) => fetch(url, { ...init, body: init?.body instanceof Uint8Array ? Uint8Array.from(init.body).buffer : init?.body, credentials: 'omit' }),
    });
    window.addEventListener('pagehide', publisher.notifyClosed);
    return () => { window.removeEventListener('pagehide', publisher.notifyClosed); client.close(); publisher.close(); };
  }, [grant, reference]);
}
