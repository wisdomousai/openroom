import type { Outline } from './outline-types.js';
import { resolveRevealOrder } from './outline-parts.js';

/** The visible position and listening choice carried from Present into a live session. */
export interface PresentationPosition {
  stepId: string;
  shown: number;
  listening?: { mode: 'room' | 'individual'; transcriptShown: boolean };
}

export function isPresentationPosition(outline: Outline, value: unknown): value is PresentationPosition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  const step = outline.steps.find((candidate) => candidate.id === position.stepId);
  if (!step || step.breakoutOf || typeof position.shown !== 'number' || !Number.isInteger(position.shown)
    || position.shown < 0 || position.shown > resolveRevealOrder(step, outline.interactions).length) return false;
  if (position.listening === undefined) return true;
  if (!position.listening || typeof position.listening !== 'object' || Array.isArray(position.listening)) return false;
  const listening = position.listening as Record<string, unknown>;
  return 'media' in step && step.media?.type === 'audio'
    && (listening.mode === 'room' || listening.mode === 'individual') && typeof listening.transcriptShown === 'boolean';
}
