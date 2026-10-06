import archiver from 'archiver';
import extractZip from 'extract-zip';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { finished } from 'node:stream/promises';
import { PDFDocument } from 'pdf-lib';
import {
  OPENROOM_PDF_SOURCE_MAX_BYTES,
  OPENROOM_RESOURCE_MAX_BYTES,
  OPENROOM_RESOURCE_MAX_COUNT,
  OPENROOM_RESOURCE_TOTAL_MAX_BYTES,
  OPENROOM_RESOURCE_EXTENSIONS as EXTENSION,
  openRoomResourceBytesMatch as bytesMatchType,
  parseOpenRoomFile,
  type OpenRoomFileResourceV1,
  type OpenRoomFileV1,
  type OpenRoomResourceContentType,
} from '@openroom/schema';

export interface OpenRoomWorkingDocument {
  directory: string;
  source: string;
  file: OpenRoomFileV1;
}

function safeEntry(name: string): boolean {
  if (name === '' || name.includes('\\') || name.startsWith('/')) return false;
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageResourcePath(directory: string, resource: OpenRoomFileResourceV1): string {
  const candidate = resolve(directory, resource.path);
  if (!candidate.startsWith(`${resolve(directory)}${sep}`)) throw new Error('Invalid resource path in deck package.');
  return candidate;
}

async function verifyResources(directory: string, file: OpenRoomFileV1): Promise<void> {
  const resources = Object.values(file.resources ?? {});
  if (resources.length > OPENROOM_RESOURCE_MAX_COUNT) throw new Error('This deck contains too many embedded resources.');
  let total = 0;
  for (const resource of resources) {
    const bytes = await readFile(packageResourcePath(directory, resource));
    total += bytes.byteLength;
    if (bytes.byteLength !== resource.size || bytes.byteLength > OPENROOM_RESOURCE_MAX_BYTES) {
      throw new Error(`${resource.name} does not match the size recorded in the deck.`);
    }
    if (sha256(bytes) !== resource.sha256) throw new Error(`${resource.name} failed its integrity check.`);
    if (!bytesMatchType(bytes, resource.contentType)) throw new Error(`${resource.name} is not a valid ${resource.contentType} resource.`);
  }
  if (total > OPENROOM_RESOURCE_TOTAL_MAX_BYTES) throw new Error('Embedded resources exceed the 50 MiB deck limit.');
  const declared = new Set(resources.map((resource) => resource.path));
  const actual = await readdir(join(directory, 'resources'), { withFileTypes: true }).catch(() => []);
  for (const entry of actual) {
    if (!entry.isFile() || !declared.has(`resources/${entry.name}`)) {
      throw new Error(`Unexpected resource in deck package: resources/${entry.name}`);
    }
  }
}

export async function createOpenRoomWorkingDirectory(root = tmpdir()): Promise<string> {
  return mkdtemp(join(root, 'openroom-document-'));
}

export async function readOpenRoomPackage(path: string, directory: string): Promise<OpenRoomWorkingDocument> {
  let entries = 0;
  let expandedBytes = 0;
  await extractZip(path, {
    dir: directory,
    onEntry(entry) {
      entries += 1;
      expandedBytes += entry.uncompressedSize;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (!safeEntry(entry.fileName) || mode === 0xa000) throw new Error('The deck package contains an unsafe ZIP entry.');
      if (entries > OPENROOM_RESOURCE_MAX_COUNT + 2 || expandedBytes > OPENROOM_RESOURCE_TOTAL_MAX_BYTES + 2 * 1024 * 1024) {
        throw new Error('The deck package exceeds its extraction limit.');
      }
      if (entry.fileName !== 'deck.yaml' && entry.fileName !== 'resources/' && !entry.fileName.startsWith('resources/')) {
        throw new Error(`Unexpected file in deck package: ${entry.fileName}`);
      }
    },
  });
  const source = await readFile(join(directory, 'deck.yaml'), 'utf8');
  const parsed = parseOpenRoomFile(source);
  if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join('\n'));
  await verifyResources(directory, parsed.file);
  return { directory, source, file: parsed.file };
}

export async function writeOpenRoomPackage(
  target: string,
  source: string,
  directory: string,
): Promise<void> {
  const parsed = parseOpenRoomFile(source);
  if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join('\n'));
  await verifyResources(directory, parsed.file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (error) => { throw error; });
  archive.pipe(output);
  archive.append(source, { name: 'deck.yaml' });
  for (const resource of Object.values(parsed.file.resources ?? {})) {
    archive.file(packageResourcePath(directory, resource), { name: resource.path, store: true });
  }
  await archive.finalize();
  await finished(output);
  const handle = await open(temporary, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
  const parent = await open(dirname(target), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function importOpenRoomResource(
  directory: string,
  sourcePath: string,
  contentType: OpenRoomResourceContentType,
  displayName = basename(sourcePath),
): Promise<{ resourceId: string; resource: OpenRoomFileResourceV1 }> {
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size <= 0 || info.size > OPENROOM_RESOURCE_MAX_BYTES) {
    throw new Error('Embedded resources must be between 1 byte and 20 MiB.');
  }
  const bytes = await readFile(sourcePath);
  if (!bytesMatchType(bytes, contentType)) throw new Error(`The selected file is not a valid ${contentType} resource.`);
  const resourceId = randomUUID();
  const path = `resources/${resourceId}${EXTENSION[contentType]}`;
  await mkdir(join(directory, 'resources'), { recursive: true });
  await copyFile(sourcePath, join(directory, path));
  return {
    resourceId,
    resource: { path, name: displayName.slice(0, 200), contentType, size: bytes.byteLength, sha256: sha256(bytes) },
  };
}

export async function inspectPdf(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > OPENROOM_PDF_SOURCE_MAX_BYTES) {
    throw new Error('Choose a PDF no larger than 100 MiB.');
  }
  const pdf = await PDFDocument.load(await readFile(path));
  return pdf.getPageCount();
}

/** The chosen page range as a standalone PDF. Shared by the embedded and uploaded paths. */
export async function copyPdfPages(sourcePath: string, fromPage: number, toPage: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(await readFile(sourcePath));
  const output = await PDFDocument.create();
  const indexes = Array.from({ length: toPage - fromPage + 1 }, (_, index) => fromPage - 1 + index);
  const pages = await output.copyPages(source, indexes);
  for (const page of pages) output.addPage(page);
  const bytes = await output.save({ useObjectStreams: true });
  if (bytes.byteLength > OPENROOM_RESOURCE_MAX_BYTES) throw new Error('The selected pages exceed the 20 MiB embedded-resource limit.');
  return bytes;
}

/** The page range named for the source file, for a synced deck's asset store. */
export function pdfPageRangeName(sourcePath: string, fromPage: number, toPage: number): string {
  const stem = basename(sourcePath, extname(sourcePath));
  return `${stem} pages ${String(fromPage)}-${String(toPage)}.pdf`.slice(0, 200);
}

export async function extractPdfResource(
  directory: string,
  sourcePath: string,
  fromPage: number,
  toPage: number,
): Promise<{ resourceId: string; resource: OpenRoomFileResourceV1 }> {
  const pageCount = await inspectPdf(sourcePath);
  if (!Number.isInteger(fromPage) || !Number.isInteger(toPage) || fromPage < 1 || toPage < fromPage || toPage > pageCount) {
    throw new Error(`Choose an inclusive page range between 1 and ${String(pageCount)}.`);
  }
  const bytes = await copyPdfPages(sourcePath, fromPage, toPage);
  const resourceId = randomUUID();
  const path = `resources/${resourceId}.pdf`;
  await mkdir(join(directory, 'resources'), { recursive: true });
  await writeFile(join(directory, path), bytes);
  return {
    resourceId,
    resource: {
      path,
      name: pdfPageRangeName(sourcePath, fromPage, toPage),
      contentType: 'application/pdf',
      size: bytes.byteLength,
      sha256: sha256(bytes),
    },
  };
}

export async function disposeOpenRoomWorkingDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
