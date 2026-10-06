/**
 * Map a DOM `Selection` inside a contentEditable part onto character offsets
 * in the part's plain text, and back. Span boundaries are character offsets in
 * the same string, so these two functions are all the canvas needs to style a
 * selection through the pure span algebra.
 *
 * Offsets are computed by walking text nodes — never `textContent.indexOf` —
 * because styled spans split the text across span boundaries while the string
 * the outline stores does not.
 *
 * Two normalizations separate the DOM from the stored string, and both live
 * here so a toolbar can never mismatch them:
 *
 *  - decorations (reveal badges, remove chrome) are drawn *inside* the part and
 *    are not part of its text, so their characters are skipped, and
 *  - the stored string is `partText()`'s: nbsp folded to space, then trimmed —
 *    so every offset is shifted by the leading whitespace the DOM still holds.
 */

function textWalker(root: HTMLElement): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement?.closest('[data-slide-decoration]') ?? null) === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
}

/** The part's characters as the DOM holds them: decorations out, nothing trimmed. */
function rawTextOf(part: HTMLElement): string {
  const walker = textWalker(part);
  let out = '';
  let current: Node | null;
  while ((current = walker.nextNode()) !== null) out += current.textContent ?? '';
  return out.replace(/\u00a0/g, ' ');
}

/** How many characters `partText()`'s trim drops off the front. */
function leadOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

/** The stored string for this part — the same normalization `partText()` does. */
function normalizedTextOf(part: HTMLElement): string {
  return rawTextOf(part).trim();
}

function rawOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) {
    // A container-level offset counts child nodes, not characters; treat it
    // as "before everything" or "after everything".
    return offset === 0 ? 0 : rawTextOf(root).length;
  }
  const walker = textWalker(root);
  let total = 0;
  let current: Node | null;
  while ((current = walker.nextNode()) !== null) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return total;
}

/**
 * The live selection as offsets into the part's stored text. Collapsed
 * selections come back collapsed; callers decide what that means.
 */
export function selectionOffsetsIn(part: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!part.contains(range.commonAncestorContainer)) return null;
  const raw = rawTextOf(part);
  const lead = leadOf(raw);
  const length = raw.trim().length;
  const clamp = (value: number): number => Math.min(length, Math.max(0, value - lead));
  const start = clamp(rawOffsetOf(part, range.startContainer, range.startOffset));
  const end = clamp(rawOffsetOf(part, range.endContainer, range.endOffset));
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Text and offsets read together, so the string a style command commits and the
 * range it styles can never come from two different reads of the DOM. Null when
 * there is no selection in this part, or when it collapses to a caret — there
 * is nothing to style.
 */
export function partSelection(
  part: HTMLElement,
): { text: string; start: number; end: number } | null {
  const offsets = selectionOffsetsIn(part);
  if (offsets === null || offsets.end <= offsets.start) return null;
  return { text: normalizedTextOf(part), start: offsets.start, end: offsets.end };
}

/** Place the caret / selection at `[start, end)` inside the part. */
export function restoreSelectionIn(part: HTMLElement, start: number, end: number): void {
  const lead = leadOf(rawTextOf(part));
  const at = (target: number): { node: Node; offset: number } | null => {
    const walker = textWalker(part);
    let total = 0;
    let current: Node | null;
    let last: Node | null = null;
    while ((current = walker.nextNode()) !== null) {
      const length = current.textContent?.length ?? 0;
      if (total + length >= target) return { node: current, offset: target - total };
      total += length;
      last = current;
    }
    return last === null ? null : { node: last, offset: last.textContent?.length ?? 0 };
  };
  const from = at(Math.min(start, end) + lead);
  const to = at(Math.max(start, end) + lead);
  if (from === null || to === null) return;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
