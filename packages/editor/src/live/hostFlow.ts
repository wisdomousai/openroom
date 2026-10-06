/**
 * Pure primary-action flow for the host (LiveHost + PresenterRemote).
 * Start → (Show results only when hidden) → Next → End.
 * Live results are the default; Hide results is a secondary control.
 *
 * Outline sessions: reveal still wins when the active interaction hides results;
 * otherwise advance is "Next step" until the last authored step, then End.
 */

import { canAdvanceOutline } from './outline-navigation';
import type { HostSnapshot, InteractionStatus } from '../types';
import { activeId as activeIdOf, statusOf } from './snapshot';

export type HostFlowKind = 'start' | 'reveal' | 'advance' | 'end';

export interface HostFlowState {
  kind: HostFlowKind;
  label: string;
}

export function deriveHostFlow(
  snapshot: HostSnapshot | null,
  opts: { pendingLeft: number; audienceSeesResults?: boolean },
): HostFlowState | null {
  if (!snapshot || snapshot.status === 'ended') return null;
  if (snapshot.status === 'lobby') {
    return { kind: 'start', label: 'Start session' };
  }
  const activeId = activeIdOf(snapshot);
  const activeStatus: InteractionStatus | null = activeId ? statusOf(snapshot, activeId) : null;
  const seesResults = opts.audienceSeesResults === true;
  if (
    activeId &&
    (activeStatus === 'open' || activeStatus === 'closed') &&
    !seesResults
  ) {
    return { kind: 'reveal', label: 'Reveal the results' };
  }
  // Tutoring: answers can be visible after Close while the key is still hidden.
  if (snapshot.outline !== undefined && activeId && activeStatus === 'closed') {
    return { kind: 'reveal', label: 'Reveal the results' };
  }

  const outline = snapshot.outline;
  if (outline !== undefined) {
    if (canAdvanceOutline(outline)) {
      return { kind: 'advance', label: 'Next slide' };
    }
    return { kind: 'end', label: 'End session' };
  }

  if (opts.pendingLeft > 0) {
    return {
      kind: 'advance',
      label: 'Next slide',
    };
  }
  return { kind: 'end', label: 'End session' };
}
