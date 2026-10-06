import {
  normalizeSession,
  outlineFromSession,
  toSession,
  type Outline,
  type NormalizedSession,
  type Session,
} from '@openroom/schema';

import { emptyAggregate } from './aggregate.js';
import { emptyQnaState } from './qna.js';
import type { InteractionRuntime, SessionState } from './types.js';

function asOutline(document: Session | Outline): Outline {
  return Array.isArray((document as Outline).steps)
    ? (document as Outline)
    : outlineFromSession(document as Session);
}

/**
 * Build the initial session state from an Outline (or a poll list compiled to one).
 * Defaults are materialized onto the stored outline so every snapshot reads the
 * same document the deck stores.
 *
 * The session starts in `lobby` at revision 0 with every interaction `pending`.
 */
export function createSession(
  document: Session | Outline,
  code: string,
  now: number,
  options?: { outlineVersion?: number; facilitator?: { id: string; name: string } },
): SessionState {
  const outline = asOutline(document);
  const normalized = normalizeSession(toSession(outline));
  const content: Outline = {
    ...outline,
    defaults: normalized.defaults,
    qna: normalized.qna,
    interactions: normalized.interactions,
  };
  const interactions: Record<string, InteractionRuntime> = {};
  for (const interaction of normalized.interactions) {
    const runtime: InteractionRuntime = {
      status: 'pending',
      ballots: {},
      aggregate: emptyAggregate(interaction),
    };
    // Peer-instruction interactions start in round 1; every other interaction
    // has no round at all.
    if (interaction.type === 'choice' && interaction.peerInstruction) runtime.round = 1;
    interactions[interaction.id] = runtime;
  }
  // `now` is part of the factory signature for symmetry with applyCommand and
  // for future createdAt use; the lobby state itself carries no timestamps.
  void now;
  const facilitator = { ...(options?.facilitator ?? { id: 'creator', name: 'Presenter' }), canRecover: true };
  return {
    facilitation: { presenterId: facilitator.id, facilitators: { [facilitator.id]: facilitator } },
    code,
    status: 'lobby',
    revision: 0,
    outline: {
      content,
      outlineVersion: options?.outlineVersion ?? 1,
      currentStepIndex: 0,
    },
    theme: normalized.defaults.theme,
    activeInteractionId: null,
    interactions,
    qna: emptyQnaState(normalized.qna.enabled),
    participants: {},
    frozen: false,
  };
}

/** Classroom poll lists compile to interaction steps whose id equals the question id. */
export function isPollOnlyOutline(outline: SessionState['outline']): boolean {
  const steps = outline.content.steps;
  return (
    steps.length > 0 &&
    steps.every((step) => step.kind === 'interaction' && step.id === step.interactionId)
  );
}

/** Interaction slice of the live outline, with defaults already materialized. */
export function sessionOf(state: SessionState): NormalizedSession {
  return normalizeSession(toSession(state.outline.content));
}
