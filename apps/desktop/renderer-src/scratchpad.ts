/**
 * The file window's end-of-session hand-off for the live console's private
 * scratchpad (@openroom/editor `live/scratchpad.ts`: this device only).
 *
 * The hand-off re-keys the notes for the workspace's Notes form. A build
 * without the workspace has no Notes form, so there is no record to prefill
 * and the live notes are cleared, as for a session with no record.
 */
import { handOffLiveNotes } from '@openroom/editor';
import { workspaceAvailable } from './destinations';

export function handOffScratchpad(sessionCode: string, sessionId: string | null): void {
  handOffLiveNotes(sessionCode, workspaceAvailable() ? sessionId : null);
}
