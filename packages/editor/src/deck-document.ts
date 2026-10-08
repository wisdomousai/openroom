import { zipSync, strToU8 } from 'fflate';
import { validateSession, type Outline } from '@openroom/schema';

/** Where an unfinished question lives, so the editor can open it. */
export type ReadinessTarget =
  | { kind: 'step'; stepId: string }
  | { kind: 'homework'; taskId: string };

export interface ReadinessIssue {
  message: string;
  /** Null for a question no slide or homework task uses. */
  target: ReadinessTarget | null;
}

/**
 * Drafts can be saved at any point; only complete questions go live. The
 * place is named the way the rail and the homework page name it: the slide
 * number in rail order, or the quiz's position among the homework quizzes.
 */
export function questionReadinessIssue(outline: Outline): ReadinessIssue | null {
  const slides = outline.steps.filter((step) => step.breakoutOf === undefined);
  const quizzes = (outline.homework?.tasks ?? []).filter((task) => task.kind === 'quiz');
  for (const interaction of outline.interactions) {
    const result = validateSession({ version: 1, meta: { title: outline.meta.title }, interactions: [interaction] });
    if (result.ok) continue;
    const step = outline.steps.find((item) => item.kind === 'interaction' && item.interactionId === interaction.id);
    if (step !== undefined) {
      const parentId = step.breakoutOf?.stepId ?? step.id;
      const number = slides.findIndex((item) => item.id === parentId) + 1;
      const place = step.breakoutOf === undefined ? `slide ${number}` : `the breakout of slide ${number}`;
      return {
        message: `Complete the question on ${place} before starting: enter the question and its answers.`,
        target: { kind: 'step', stepId: step.id },
      };
    }
    const quiz = quizzes.findIndex((task) => task.kind === 'quiz' && task.interactionId === interaction.id);
    if (quiz !== -1) {
      const task = quizzes[quiz]!;
      const place = quizzes.length === 1 ? 'the homework quiz' : `homework quiz ${quiz + 1}`;
      return {
        message: `Complete ${place} before starting: enter the question and its answers.`,
        target: { kind: 'homework', taskId: task.id },
      };
    }
    return {
      message: 'Complete every question in this deck before starting: enter the question and its answers.',
      target: null,
    };
  }
  return null;
}

/** The readiness sentence alone, for callers that only need to refuse a start. */
export function questionReadinessMessage(outline: Outline): string | null {
  return questionReadinessIssue(outline)?.message ?? null;
}

// The server builds the draft zero from the same blank deck, so it lives in schema.
export { blankDeck } from '@openroom/schema';

export { renameDeck } from './deck-edit/outline-edit';

export function downloadDeckFile(source: string, title: string, resources: Record<string, Uint8Array> = {}): void {
  const url = URL.createObjectURL(new Blob([zipSync({ ...resources, 'deck.yaml': strToU8(source) }, { level: 0 })], { type: 'application/vnd.openroom.deck+zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'deck'}.openroom`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
