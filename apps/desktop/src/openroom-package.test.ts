import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeVoiceWav, stringifyOpenRoomFile, type OpenRoomFileV1 } from '@openroom/schema';

import {
  createOpenRoomWorkingDirectory,
  importOpenRoomResource,
  copyPdfPages,
  extractPdfResource,
  pdfPageRangeName,
  readOpenRoomPackage,
  writeOpenRoomPackage,
} from './openroom-package.js';

const cleanup: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function sourcePdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page += 1) {
    const sheet = pdf.addPage([400, 500]);
    sheet.drawText(`Source page ${String(page)}`, { x: 50, y: 430, size: 24, font });
  }
  await writeFile(path, await pdf.save());
}

function manifest(resourceId: string, resource: Awaited<ReturnType<typeof extractPdfResource>>['resource']): OpenRoomFileV1 {
  return {
    format: 'openroom-file',
    fileVersion: 1,
    fileId: 'f5235e21-d50f-409f-9fe6-5ec41885d9c5',
    localRevision: 1,
    resources: { [resourceId]: resource },
    outline: {
      version: 1,
      meta: { title: 'Selected pages' },
      steps: [{
        id: 'handout',
        kind: 'blank',
        elements: [{
          id: 'pdf-1',
          type: 'pdf',
          resourceId,
          title: 'Pages two and three',
          box: { x: 0, y: 0, w: 100, h: 100 },
        }],
      }, { id: 'check', kind: 'interaction', interactionId: 'check' }],
      interactions: [{
        id: 'check',
        type: 'choice',
        prompt: 'Ready?',
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      }],
    },
  };
}

describe('.openroom ZIP packages', () => {
  it('embeds and verifies a WAV recording with its listening mode and private transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openroom-audio-test-'));
    cleanup.push(root);
    const working = await createOpenRoomWorkingDirectory(root);
    const bytes = encodeVoiceWav(new Float32Array(16000));
    const source = join(root, 'appointment.wav');
    await writeFile(source, bytes);
    const embedded = await importOpenRoomResource(working, source, 'audio/wav');
    const file = manifest(embedded.resourceId, embedded.resource);
    file.outline = { version: 1, meta: { title: 'Listening' }, interactions: [], steps: [{ id: 'listen', kind: 'media', media: {
      type: 'audio', resourceId: embedded.resourceId, alt: 'Appointment', listening: { mode: 'individual', transcript: 'À jeudi !' },
    } }] };
    const archive = join(root, 'listening.openroom');
    await writeOpenRoomPackage(archive, stringifyOpenRoomFile(file), working);
    const reopenedDirectory = await createOpenRoomWorkingDirectory(root);
    const reopened = await readOpenRoomPackage(archive, reopenedDirectory);
    expect(reopened.file.outline).toEqual(file.outline);
    expect(new Uint8Array(await readFile(join(reopenedDirectory, embedded.resource.path)))).toEqual(bytes);
  });

  it('stores only the selected PDF pages and reopens with verified bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openroom-package-test-'));
    cleanup.push(root);
    const working = await createOpenRoomWorkingDirectory(root);
    const source = join(root, 'source.pdf');
    await sourcePdf(source);
    const embedded = await extractPdfResource(working, source, 2, 3);
    const outputBytes = await readFile(join(working, embedded.resource.path));
    expect((await PDFDocument.load(outputBytes)).getPageCount()).toBe(2);

    const file = manifest(embedded.resourceId, embedded.resource);
    const archive = join(root, 'french-b1.openroom');
    await writeOpenRoomPackage(archive, stringifyOpenRoomFile(file), working);

    const reopenedDirectory = await createOpenRoomWorkingDirectory(root);
    const reopened = await readOpenRoomPackage(archive, reopenedDirectory);
    expect(reopened.file.outline.steps[0]).toEqual(expect.objectContaining({ id: 'handout' }));
    expect(await readFile(join(reopenedDirectory, embedded.resource.path))).toEqual(outputBytes);
  });

  it('returns the same pages as bytes for a synced design, with no package to write into', async () => {
    // Independent exports include their creation time; keep it fixed for byte equality.
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
    const root = await mkdtemp(join(tmpdir(), 'openroom-pdf-bytes-'));
    cleanup.push(root);
    const source = join(root, 'handout.pdf');
    await sourcePdf(source);

    const bytes = await copyPdfPages(source, 2, 3);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(pdfPageRangeName(source, 2, 3)).toBe('handout pages 2-3.pdf');

    // The uploaded path must produce the identical document the embedded path would.
    const working = await createOpenRoomWorkingDirectory(root);
    const embedded = await extractPdfResource(working, source, 2, 3);
    expect(await readFile(join(working, embedded.resource.path))).toEqual(Buffer.from(bytes));
  });

  it('refuses a page range outside the document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openroom-pdf-range-'));
    cleanup.push(root);
    const source = join(root, 'handout.pdf');
    await sourcePdf(source);
    await expect(copyPdfPages(source, 1, 99)).rejects.toThrow();
  });
});
