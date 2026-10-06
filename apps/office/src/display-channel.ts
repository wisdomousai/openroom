import type { PresentationComposition } from '@openroom/schema';
import type { ConnectionStatus, StageSnapshot } from '@openroom/sdk';
import { composedStep, type ActivityBinding, type SessionReference } from './bindings';

/** This channel carries audience projections only: no account/host/stage credentials. */
export interface DisplayPublication {
  type: 'openroom.display'; version: 1; presentationId: string; sessionId: string; presentation: PresentationComposition;
  snapshot: StageSnapshot; status: ConnectionStatus;
}
export const displayChannelName = (presentationId: string) => `openroom-display:${presentationId}`;
const audienceRole = (value: StageSnapshot) => value?.role === 'stage';

export function displayMatches(input: unknown, binding: ActivityBinding, session: SessionReference | null): boolean {
  const value = input as DisplayPublication | null;
  return value?.type === 'openroom.display' && value.version === 1 && audienceRole(value.snapshot)
    && value.presentationId === binding.presentationId && !!composedStep(value.presentation, binding)
    && session?.presentationId === binding.presentationId && session.sessionId === value.sessionId;
}

export function displayIsCurrent(value: DisplayPublication, binding: ActivityBinding): boolean {
  const stepId = composedStep(value.presentation, binding);
  const current = value.snapshot.outline?.currentStep;
  return !!stepId && (value.snapshot.status === 'ended' || current?.id === stepId || current?.breakoutOf?.stepId === stepId);
}

export function createDisplayPublisher(reference: SessionReference, presentation: PresentationComposition) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(displayChannelName(reference.presentationId));
  let current: DisplayPublication | null = null;
  const send = () => { if (current) channel.postMessage(current); };
  channel.onmessage = (event: MessageEvent) => { if (event.data?.type === 'openroom.display.request') send(); };
  const heartbeat = setInterval(send, 4000);
  const notifyClosed = () => channel.postMessage({ type: 'openroom.display.closed', sessionId: reference.sessionId });
  return {
    update(snapshot: StageSnapshot, status: ConnectionStatus) {
      if (!audienceRole(snapshot)) throw new Error('Only audience state can be displayed.');
      current = { type: 'openroom.display', version: 1, presentationId: reference.presentationId, sessionId: reference.sessionId, presentation, snapshot, status }; send();
    },
    notifyClosed,
    close() { clearInterval(heartbeat); notifyClosed(); channel.close(); current = null; },
  };
}
