import { zipSync, strToU8 } from 'fflate';
import { validateSession, type Outline } from '@openroom/schema';

/** Drafts can be saved at any point; only complete questions go live. */
export function questionReadinessMessage(outline: Outline): string | null {
  for (const [index, interaction] of outline.interactions.entries()) {
    const result = validateSession({ version: 1, meta: { title: outline.meta.title }, interactions: [interaction] });
    if (result.ok) continue;
    const step = outline.steps.findIndex((step) => step.kind === 'interaction' && step.interactionId === interaction.id);
    const place = step >= 0 ? `slide ${step + 1}` : `homework question ${index + 1}`;
    return `Complete the question on ${place} before starting: enter the question and its answers.`;
  }
  return null;
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
