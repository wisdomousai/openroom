/** A measured text fragment in its ink layer's normalized coordinate space. */
export interface TokenBox { x: number; y: number; w: number; h: number }
export type TokenBoxes = Record<string, TokenBox[]>;
export interface TokenSpan { partKey: string; token: number; endToken?: number }

export function tokenKey(partKey: string, token: number): string { return `${partKey} ${token}`; }

export function markTokens(mark: TokenSpan): { partKey: string; token: number }[] {
  const last = Math.min(mark.endToken ?? mark.token, mark.token + 199);
  return Array.from({ length: Math.max(0, last - mark.token + 1) }, (_, offset) => ({ partKey: mark.partKey, token: mark.token + offset }));
}

export function unionBox(boxes: readonly TokenBox[]): TokenBox | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, w: Math.max(...boxes.map((box) => box.x + box.w)) - x, h: Math.max(...boxes.map((box) => box.y + box.h)) - y };
}

/** Join selected fragments on the same visual line, never across a line break. */
export function lineBoxes(boxes: readonly TokenBox[]): TokenBox[] {
  const lines: TokenBox[] = [];
  for (const box of [...boxes].filter((box) => box.w > 0 && box.h > 0).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.findIndex((candidate) => Math.min(candidate.y + candidate.h, box.y + box.h) - Math.max(candidate.y, box.y) >= Math.min(candidate.h, box.h) * 0.5);
    if (line < 0) lines.push(box);
    else lines[line] = unionBox([lines[line]!, box])!;
  }
  return lines;
}

export function spanBoxes(boxes: TokenBoxes, mark: TokenSpan): TokenBox[] {
  return lineBoxes(markTokens(mark).flatMap((target) => boxes[tokenKey(target.partKey, target.token)] ?? []));
}

/** Inline fragments preserve a long word that itself wraps onto more than one line. */
export function measureTokens(root: HTMLElement | null, targets: readonly { partKey: string; token: number }[]): TokenBoxes {
  if (!root || targets.length === 0) return {};
  const scope = root.parentElement ?? root;
  const frame = root.getBoundingClientRect();
  if (!frame.width || !frame.height) return {};
  const boxes: TokenBoxes = {};
  for (const target of targets) {
    if (!/^[\w-]+$/.test(target.partKey) || !Number.isInteger(target.token)) continue;
    const key = tokenKey(target.partKey, target.token);
    if (boxes[key]) continue;
    const found = scope.querySelector(`[data-part="${target.partKey}"][data-token="${target.token}"]`)
      ?? scope.querySelector(`[data-part="${target.partKey}"] [data-token="${target.token}"]`);
    if (!(found instanceof HTMLElement)) continue;
    boxes[key] = [...found.getClientRects()].filter((box) => box.width > 0 && box.height > 0).map((box) => ({
      x: (box.left - frame.left) / frame.width, y: (box.top - frame.top) / frame.height,
      w: box.width / frame.width, h: box.height / frame.height,
    }));
  }
  return boxes;
}
