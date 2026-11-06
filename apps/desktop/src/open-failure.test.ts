import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finished } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { openFailureReason } from './open-failure.js';
import { createOpenRoomWorkingDirectory, readOpenRoomPackage } from './openroom-package.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function zipWith(path: string, entries: Record<string, string>): Promise<void> {
  const output = createWriteStream(path);
  const archive = archiver('zip');
  archive.pipe(output);
  for (const [name, text] of Object.entries(entries)) archive.append(text, { name });
  await archive.finalize();
  await finished(output);
}

/** What the reader throws for this file, as the tutor reads it. */
async function reasonFor(write: (path: string) => Promise<void>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openroom-open-failure-'));
  cleanup.push(directory);
  const path = join(directory, 'lesson.openroom');
  await write(path);
  try {
    await readOpenRoomPackage(path, await createOpenRoomWorkingDirectory(directory));
  } catch (cause) {
    return openFailureReason(cause);
  }
  throw new Error('The file opened.');
}

describe('openFailureReason', () => {
  it('names a text file renamed to .openroom as damaged', async () => {
    expect(await reasonFor((path) => writeFile(path, 'not a deck'))).toBe('The file is damaged or is not an OpenRoom deck.');
  });

  it('names a ZIP without a deck', async () => {
    expect(await reasonFor((path) => zipWith(path, { 'resources/notes.txt': 'x' }))).toBe('The file holds no OpenRoom deck.');
  });

  it('names a file from a newer OpenRoom', async () => {
    const deck = JSON.stringify({ format: 'openroom-file', fileVersion: 99, fileId: 'f5235e21-d50f-409f-9fe6-5ec41885d9c5', localRevision: 0, outline: {} });
    expect(await reasonFor((path) => zipWith(path, { 'deck.yaml': deck }))).toBe(
      'The file was saved by a newer version of OpenRoom. Update OpenRoom to open it.',
    );
  });

  it('names a file that is gone', async () => {
    expect(await reasonFor(async () => undefined)).toBe('The file is no longer there.');
  });
});
