import type { SessionListening, SessionState } from './types.js';

/** Live overrides last for this visit to the audio slide only. */
export function listeningFor(state: SessionState): SessionListening | undefined {
  if (state.status !== 'live') return undefined;
  const step = state.outline.content.steps[state.outline.currentStepIndex];
  const media = step && 'media' in step ? step.media : undefined;
  if (!step || media?.type !== 'audio' || !media.listening) return undefined;
  return state.listening?.stepId === step.id
    ? state.listening
    : { stepId: step.id, mode: media.listening.mode, transcriptShown: false };
}
