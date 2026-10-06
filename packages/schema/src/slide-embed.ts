/** A stable slide address, not a credential. Resolving it still requires deck access. */
export interface SlideEmbedReference { deckId: string; stepId: string }
const reference = /^[A-Za-z0-9_-]{1,160}$/;
const PREFIX = 'openroom-slide:1:';

export function slideEmbedCode(value: SlideEmbedReference): string {
  if (!reference.test(value.deckId) || !reference.test(value.stepId)) throw new Error('Invalid slide reference.');
  return `${PREFIX}${value.deckId}:${value.stepId}`;
}

export function parseSlideEmbedCode(text: string): SlideEmbedReference | null {
  const code = text.trim();
  if (!code.startsWith(PREFIX) || code.length > 350) return null;
  const parts = code.slice(PREFIX.length).split(':');
  if (parts.length !== 2 || !parts.every((part) => reference.test(part))) return null;
  return { deckId: parts[0]!, stepId: parts[1]! };
}
