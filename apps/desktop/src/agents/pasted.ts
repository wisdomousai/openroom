/**
 * Images pasted or dropped into the agent chat.
 *
 * They arrive as bytes from the renderer and are written into the conversation's
 * own scratch folder, then travel as ordinary path attachments. Nothing is
 * uploaded: the file lives beside the other attachments and is deleted with the
 * conversation.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** What a browser paste can carry that an agent can actually read. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** A pasted screenshot is easily several MB; beyond this it is a file to attach, not to paste. */
export const MAX_PASTED_BYTES = 20 * 1024 * 1024;

export interface PastedImage {
  /** MIME type reported by the clipboard or drop event. */
  type: string;
  /** Original file name when the drop had one; pastes usually have none. */
  name?: string;
  bytes: Uint8Array;
}

export function pastedExtension(type: string): string | null {
  return EXTENSIONS[type.toLowerCase()] ?? null;
}

/**
 * A stable, collision-free name inside one conversation. The index keeps two
 * screenshots pasted in the same second apart without needing a clock.
 */
export function pastedFileName(input: { type: string; name?: string }, index: number): string | null {
  const extension = pastedExtension(input.type);
  if (extension === null) return null;
  const stem = (input.name ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${stem === '' ? 'pasted' : stem}-${String(index)}.${extension}`;
}

export interface PastedImageStoreDeps {
  /** Directory that holds pasted images until the conversation is reset. */
  dir(): string;
  mkdirFn?: (path: string) => Promise<void>;
  writeFn?: (path: string, bytes: Uint8Array) => Promise<void>;
  rmFn?: (path: string) => Promise<void>;
}

export interface PastedImageStore {
  /** Writes one image and returns its path, or null when the type is unsupported or too large. */
  save(image: PastedImage): Promise<string | null>;
  /** Drops every pasted image; the run already copied what it needed into its workdir. */
  clear(): Promise<void>;
}

export function createPastedImageStore(deps: PastedImageStoreDeps): PastedImageStore {
  const mkdirFn = deps.mkdirFn ?? ((path: string) => mkdir(path, { recursive: true }).then(() => undefined));
  const writeFn = deps.writeFn ?? ((path: string, bytes: Uint8Array) => writeFile(path, bytes));
  const rmFn = deps.rmFn ?? ((path: string) => rm(path, { recursive: true, force: true }));
  let counter = 0;

  return {
    async save(image) {
      if (image.bytes.byteLength === 0 || image.bytes.byteLength > MAX_PASTED_BYTES) return null;
      const name = pastedFileName(image, (counter += 1));
      if (name === null) return null;
      const dir = deps.dir();
      await mkdirFn(dir);
      const path = join(dir, name);
      await writeFn(path, image.bytes);
      return path;
    },

    async clear() {
      await rmFn(deps.dir());
    },
  };
}
