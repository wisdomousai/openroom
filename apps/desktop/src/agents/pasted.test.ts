import { describe, expect, it } from 'vitest';

import { MAX_PASTED_BYTES, createPastedImageStore, pastedFileName } from './pasted.js';

function harness() {
  const written: Array<{ path: string; size: number }> = [];
  const store = createPastedImageStore({
    dir: () => '/data/agent-pastes',
    mkdirFn: () => Promise.resolve(),
    writeFn: (path, bytes) => {
      written.push({ path, size: bytes.byteLength });
      return Promise.resolve();
    },
  });
  return { store, written };
}

describe('pastedFileName', () => {
  it('names a bare paste by type', () => {
    expect(pastedFileName({ type: 'image/png' }, 1)).toBe('pasted-1.png');
    expect(pastedFileName({ type: 'IMAGE/JPEG' }, 2)).toBe('pasted-2.jpg');
  });

  it('keeps a dropped file name but strips anything path-like', () => {
    expect(pastedFileName({ type: 'image/png', name: 'Lesson 3/photo.PNG' }, 1)).toBe('Lesson-3-photo-1.png');
  });

  it('refuses types an agent cannot read', () => {
    expect(pastedFileName({ type: 'application/pdf' }, 1)).toBeNull();
    expect(pastedFileName({ type: 'text/plain' }, 1)).toBeNull();
  });
});

describe('createPastedImageStore', () => {
  it('writes each image under its own name and returns the path', async () => {
    const { store, written } = harness();
    const first = await store.save({ type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    const second = await store.save({ type: 'image/png', bytes: new Uint8Array([4]) });
    expect(first).toBe('/data/agent-pastes/pasted-1.png');
    expect(second).toBe('/data/agent-pastes/pasted-2.png');
    expect(written).toHaveLength(2);
  });

  it('drops empty, oversized, and unsupported payloads without writing', async () => {
    const { store, written } = harness();
    expect(await store.save({ type: 'image/png', bytes: new Uint8Array() })).toBeNull();
    expect(await store.save({ type: 'image/png', bytes: new Uint8Array(MAX_PASTED_BYTES + 1) })).toBeNull();
    expect(await store.save({ type: 'application/zip', bytes: new Uint8Array([1]) })).toBeNull();
    expect(written).toHaveLength(0);
  });
});

describe('clear', () => {
  it('removes the whole pasted-image folder', async () => {
    const removed: string[] = [];
    const store = createPastedImageStore({
      dir: () => '/data/agent-pastes',
      mkdirFn: () => Promise.resolve(),
      writeFn: () => Promise.resolve(),
      rmFn: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
    });
    await store.save({ type: 'image/png', bytes: new Uint8Array([1]) });
    await store.clear();
    expect(removed).toEqual(['/data/agent-pastes']);
  });
});
