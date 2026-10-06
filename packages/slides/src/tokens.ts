/**
 * Word numbering, in one place.
 *
 * Every surface numbers a part's words the same way — split on whitespace,
 * `index >> 1` — which is what lets the projector, the console mirror and the
 * phone mark the same word. The deck editor needs the same arithmetic to hit-test a
 * caret, so it lives here rather than being written twice and drifting.
 */
export const TOKEN_SPLIT = /(\s+)/;

/**
 * The token index a character offset falls in, or null when the offset lands
 * on whitespace or past the end.
 *
 * Offsets are into the part's own text, exactly as `TokenWords` splits it.
 */
export function tokenIndexAt(text: string, charOffset: number): number | null {
  if (charOffset < 0 || charOffset > text.length) return null;
  const chunks = text.split(TOKEN_SPLIT);
  let cursor = 0;
  for (const [index, chunk] of chunks.entries()) {
    const end = cursor + chunk.length;
    const whitespace = /^\s+$/.test(chunk);
    /*
     * A caret sitting exactly on a word's trailing boundary still names that
     * word — that is where a double-click leaves it, and where the browser
     * puts a caret clicked at the right-hand edge of the last letter.
     */
    if (!whitespace && chunk !== '' && charOffset >= cursor && charOffset <= end) {
      return index >> 1;
    }
    cursor = end;
  }
  return null;
}

/**
 * The word at a character offset, expanded to its whitespace boundaries.
 * Returns null on the same misses `tokenIndexAt` does.
 */
export function wordAt(text: string, charOffset: number): string | null {
  const index = tokenIndexAt(text, charOffset);
  if (index === null) return null;
  const word = text.split(TOKEN_SPLIT)[index * 2];
  return word === undefined || word === '' ? null : word;
}
