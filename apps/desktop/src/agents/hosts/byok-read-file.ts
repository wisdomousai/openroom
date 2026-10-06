/**
 * The one non-MCP tool the API-key host gets.
 *
 * The CLI hosts read attached school files with the vendor's own file tool. This
 * runtime is in-process and has no such tool, so without this the attach button
 * would do nothing. The boundary is narrower than what Claude and Codex get, and
 * OpenRoom enforces it rather than the vendor: read only, inside the conversation
 * workspace, the temporary attachments directory, or a folder the tutor named
 * this turn — resolved through realpath so `..` and symlinks cannot escape.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** Large enough for a worksheet, small enough that one call cannot fill the context. */
export const READ_FILE_LIMIT_BYTES = 512_000;

export interface ReadFileResult {
  text?: string;
  truncated?: boolean;
  error?: string;
}

function contains(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * A path that does not exist has no realpath, and on macOS the un-resolved form
 * (`/var/...` rather than `/private/var/...`) sits outside every canonical root —
 * so a typo inside the workspace would be reported as an escape attempt. Fall
 * back to the nearest existing ancestor, which is what the check needs anyway.
 */
async function canonical(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(await canonical(parent), basename(absolute));
  }
}

export interface ReadFileDeps {
  readFile?(path: string): Promise<string>;
  realpath?(path: string): Promise<string>;
  size?(path: string): Promise<number>;
}

/**
 * `roots` are the allowed directories for this turn. Everything else is refused
 * with a result the model can act on rather than a throw that ends the turn.
 */
export function createReadFile(roots: string[], deps: ReadFileDeps = {}) {
  const canonicalPath = deps.realpath ?? canonical;
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const size = deps.size ?? (async (path: string) => (await stat(path)).size);

  return async function readWithinWorkspace(path: string): Promise<ReadFileResult> {
    const target = await canonicalPath(path);
    const allowed = await Promise.all(roots.map(canonicalPath));
    if (!allowed.some((root) => contains(root, target))) {
      return { error: 'path-outside-workspace' };
    }
    try {
      const bytes = await size(target);
      const text = await read(target);
      return bytes > READ_FILE_LIMIT_BYTES
        ? { text: text.slice(0, READ_FILE_LIMIT_BYTES), truncated: true }
        : { text };
    } catch {
      return { error: 'file-not-readable' };
    }
  };
}
