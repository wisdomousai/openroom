import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { createReadFile } from './byok-read-file.js';

let workdir = '';
let outside = '';

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'byok-read-'));
  workdir = join(root, 'conv');
  outside = join(root, 'private');
  await mkdir(join(workdir, 'attachments'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(workdir, 'attachments', 'worksheet.md'), '# Fractions', 'utf8');
  await writeFile(join(outside, 'taxes.md'), 'secret', 'utf8');
  await symlink(join(outside, 'taxes.md'), join(workdir, 'link.md'));
});

describe('createReadFile', () => {
  it('reads a file inside an allowed root', async () => {
    const read = createReadFile([workdir]);
    expect(await read(join(workdir, 'attachments', 'worksheet.md'))).toEqual({ text: '# Fractions' });
  });

  it('refuses a path outside every root', async () => {
    const read = createReadFile([workdir]);
    expect(await read(join(outside, 'taxes.md'))).toEqual({ error: 'path-outside-workspace' });
  });

  it('refuses a traversal that climbs out of a root', async () => {
    const read = createReadFile([workdir]);
    expect(await read(join(workdir, '..', 'private', 'taxes.md'))).toEqual({
      error: 'path-outside-workspace',
    });
  });

  it('refuses a symlink that points out of a root', async () => {
    const read = createReadFile([workdir]);
    expect(await read(join(workdir, 'link.md'))).toEqual({ error: 'path-outside-workspace' });
  });

  it('reports an unreadable file instead of throwing', async () => {
    const read = createReadFile([workdir]);
    expect(await read(join(workdir, 'missing.md'))).toEqual({ error: 'file-not-readable' });
  });

  it('truncates a file past the size cap', async () => {
    const read = createReadFile([workdir], {
      realpath: (path) => Promise.resolve(path),
      size: () => Promise.resolve(1_000_000),
      readFile: () => Promise.resolve('x'.repeat(1_000_000)),
    });
    const result = await read(join(workdir, 'big.md'));
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(512_000);
  });
});
