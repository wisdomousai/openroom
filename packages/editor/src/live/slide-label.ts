import { fillTheGapsPromptText } from '@openroom/schema';

import { stepLabel } from './utils';

/** Longest slide name the rail and the footer tabs take before an ellipsis. */
const LABEL_MAX = 80;

/**
 * The name of a slide in the rail, the footer tabs and the phone remote. An
 * untitled question goes by its prompt, as the audience reads it (gap markers
 * drawn as blanks), so two questions in a row are not both "Question".
 */
export function slideLabel(
  step: {
    id: string;
    kind: string;
    title?: string;
    term?: string;
    body?: string;
    interactionId?: string;
  },
  interactions?: readonly { id: string; prompt?: string }[],
): string {
  if (step.kind === 'interaction' && !(typeof step.title === 'string' && step.title.trim() !== '')) {
    const prompt = interactions?.find((item) => item.id === step.interactionId)?.prompt;
    const text = prompt === undefined ? '' : fillTheGapsPromptText(prompt).replace(/\s+/g, ' ').trim();
    if (text !== '') return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text;
  }
  return stepLabel(step);
}
