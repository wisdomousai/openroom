/**
 * The one drag protocol in the library.
 *
 * A row dragged out of the list and the inspector's own header drag produce the
 * *same* payload, so the tree rail has a single drop handler and there is only
 * ever one answer to "what does dropping this here do?".
 */
export const ROW_DRAG_MIME = 'application/x-openroom-rows';

/** Library rows are decks. Folders move through the tree, not this payload. */
export type DragKind = 'deck';

export interface DragRow {
  kind: DragKind;
  id: string;
}

export function serializeRows(rows: readonly DragRow[]): string {
  return JSON.stringify(rows.map((row) => `${row.kind}:${row.id}`));
}

export function parseRows(data: string): DragRow[] {
  let keys: unknown;
  try {
    keys = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(keys)) return [];
  const rows: DragRow[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const at = key.indexOf(':');
    if (at <= 0) continue;
    const kind = key.slice(0, at);
    if (kind !== 'deck') continue;
    rows.push({ kind, id: key.slice(at + 1) });
  }
  return rows;
}
