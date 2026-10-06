/**
 * Where the desktop document window starts a live session.
 *
 *  - signed in: the workspace (control plane), as for every hosted deck;
 *  - signed out with a live server set: that relay, anonymous and
 *    pseudonymous sessions only;
 *  - signed out without one: no live session; Present works offline.
 */
import type { OpenRoomDesktopBridge } from '@openroom/editor';

export type DesktopLiveRoute =
  | { kind: 'workspace' }
  | { kind: 'relay'; origin: string }
  | { kind: 'offline' };

export const OFFLINE_LIVE_MESSAGE = 'Live sessions need a sign-in or a live server. Present works offline.';

export async function desktopLiveRoute(
  signedIn: () => Promise<boolean>,
  bridge: OpenRoomDesktopBridge | null,
): Promise<DesktopLiveRoute> {
  if (await signedIn().catch(() => false)) return { kind: 'workspace' };
  if (bridge === null || typeof bridge.relayStatus !== 'function') return { kind: 'offline' };
  const status = await bridge.relayStatus().catch(() => null);
  return status !== null && status.origin !== null && status.hasKey ? { kind: 'relay', origin: status.origin } : { kind: 'offline' };
}
