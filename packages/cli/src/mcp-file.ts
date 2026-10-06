/**
 * Disk-backed FileBinding for headless `openroom mcp`.
 * Same envelope + atomic-enough write as desktop: stringify, write, bump revision.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {
  editableOutlineForOpenRoomFile,
  OPENROOM_RESOURCE_MAX_BYTES,
  parseOpenRoomFile,
  stringifyOpenRoomFile,
  updateOpenRoomFileOutline,
  validateOutline,
  type OpenRoomFileV1,
  type OpenRoomResourceContentType,
  type Outline,
} from '@openroom/schema';
import type { FileBinding } from '@openroom/mcp';

import { desktopHolds } from './mcp-lock.js';
import { readOpenRoomArchive, writeOpenRoomArchive } from './openroom-zip.js';

const IMAGE_TYPES: Record<string, OpenRoomResourceContentType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

export function loadOpenRoomBinding(documentPath: string): FileBinding {
  const entries = readOpenRoomArchive(documentPath);
  let file = readDocument(entries);
  let draft: { source: string; baseRevision: number } | undefined;

  const binding: FileBinding = {
    get fileId() {
      return file.fileId;
    },
    get localRevision() {
      return file.localRevision;
    },
    get title() {
      return file.outline.meta.title;
    },
    getOutline() {
      return editableOutlineForOpenRoomFile(file);
    },
    saveOutline(outline, baseRevision) {
      if (desktopHolds(documentPath)) {
        return { ok: false, errors: [{ code: 'E_FILE', path: '/', message: 'file-open-in-desktop' }] };
      }
      if (baseRevision !== file.localRevision) {
        return { ok: false, conflict: true, latestVersion: file.localRevision };
      }
      const parsed = validateOutline(outline);
      if (!parsed.ok) return { ok: false, errors: parsed.errors };
      const nextOutline = parsed.outline as Outline;
      const current = editableOutlineForOpenRoomFile(file);
      if (JSON.stringify(current) === JSON.stringify(nextOutline)) {
        return { ok: true, version: file.localRevision, unchanged: true };
      }
      file = {
        ...updateOpenRoomFileOutline(file, nextOutline),
        localRevision: file.localRevision + 1,
      };
      writeDocument(documentPath, entries, file);
      draft = undefined;
      return { ok: true, version: file.localRevision };
    },
    putDraft(source, baseRevision) {
      draft = { source, baseRevision };
      return { ok: true };
    },
    insertLocalImage(sourcePath, alt) {
      if (desktopHolds(documentPath)) {
        throw new Error('file-open-in-desktop');
      }
      const ext = extname(sourcePath).toLowerCase();
      const contentType = IMAGE_TYPES[ext];
      if (contentType === undefined) throw new Error('unsupported-image-type');
      const bytes = readFileSync(sourcePath);
      if (bytes.length === 0 || bytes.length > OPENROOM_RESOURCE_MAX_BYTES) throw new Error('image-too-large');
      const id = randomUUID();
      const path = `resources/${id}${ext === '.jpeg' ? '.jpg' : ext}`;
      entries.set(path, bytes);
      file = {
        ...file,
        localRevision: file.localRevision + 1,
        resources: {
          ...(file.resources ?? {}),
          [id]: {
            path,
            name: basename(sourcePath).slice(0, 200),
            contentType,
            size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        },
      };
      writeDocument(documentPath, entries, file);
      return { resourceId: id, path, ...(alt === undefined ? {} : { alt }) };
    },
  };
  void draft;
  return binding;
}

function readDocument(entries: ReadonlyMap<string, Buffer>): OpenRoomFileV1 {
  const manifest = entries.get('deck.yaml');
  if (manifest === undefined) throw new Error('invalid .openroom file: deck.yaml is missing');
  const parsed = parseOpenRoomFile(manifest.toString('utf8'));
  if (!parsed.ok) {
    const message = parsed.errors.map((error) => error.message).join('; ');
    throw new Error(`invalid .openroom file: ${message}`);
  }
  return parsed.file;
}

function writeDocument(path: string, entries: Map<string, Buffer>, file: OpenRoomFileV1): void {
  entries.set('deck.yaml', Buffer.from(stringifyOpenRoomFile(file), 'utf8'));
  const declared = new Set(['deck.yaml', ...Object.values(file.resources ?? {}).map((resource) => resource.path)]);
  for (const name of entries.keys()) if (!declared.has(name)) entries.delete(name);
  writeOpenRoomArchive(path, entries);
}
