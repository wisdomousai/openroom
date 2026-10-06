/**
 * The local document an MCP host binds when the current deck is a `.openroom`
 * file. The Worker never sees this; only desktop / headless `ToolDeps` do.
 *
 * `fileId` is the envelope id. Agents keep using `deckId` in the existing
 * tools — the multiplexer treats the two as the same string for a bound file.
 */
export interface FileBinding {
  fileId: string;
  localRevision: number;
  title: string;
  /** Current outline (editable / local-media placeholders allowed). */
  getOutline(): unknown;
  /**
   * Stamp a new local revision. `baseRevision` is `localRevision` when the
   * agent last read. Conflict → latestRevision so the agent re-gets.
   */
  saveOutline(
    outline: unknown,
    baseRevision: number,
  ):
    | { ok: true; version: number; unchanged?: boolean }
    | { ok: false; conflict: true; latestVersion: number }
    | { ok: false; errors: unknown };
  putDraft?(source: string, baseRevision: number): { ok: true };
  /**
   * Copy an image into the package and register it. Returns the resource id to
   * put on a `media` step. Hosted backends ignore this.
   */
  insertLocalImage?(
    sourcePath: string,
    alt?: string,
  ): { resourceId: string; path: string; alt?: string };
}

export function isBoundFileId(file: FileBinding | null, deckId: string): boolean {
  return file !== null && file.fileId === deckId;
}
