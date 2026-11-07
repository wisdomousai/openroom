/** The longest quote a correction accepts (`parseLearnerFeedback`). */
const QUOTE_MAX = 2000;

/**
 * The words between `start` and `end` as an exact slice of `body`, without
 * the whitespace around them. Sharing a correction needs `body.includes(quote)`,
 * so the quote keeps the learner's own spaces and line breaks inside it.
 */
export function quoteAt(body: string, start: number, end: number): string | null {
  while (start < end && /\s/.test(body[start]!)) start += 1;
  while (end > start && /\s/.test(body[end - 1]!)) end -= 1;
  const quote = body.slice(start, end);
  return quote && quote.length <= QUOTE_MAX ? quote : null;
}

/**
 * The part of the page selection that lies inside `container`, which shows
 * `body` as its only text. Offsets come from the DOM text, not from
 * `Selection.toString()`, which may change line breaks and spaces.
 */
export function selectedQuote(container: Node, body: string, selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || container.textContent !== body) return null;
  const range = selection.getRangeAt(0);
  const whole = document.createRange();
  whole.selectNodeContents(container);
  const offset = (node: Node, at: number) => {
    const side = whole.comparePoint(node, at);
    if (side !== 0) return side < 0 ? 0 : body.length;
    const before = document.createRange();
    before.setStart(container, 0);
    before.setEnd(node, at);
    return before.toString().length;
  };
  try {
    return quoteAt(body, offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset));
  } catch {
    return null; // The selection is in another document or shadow tree.
  }
}
