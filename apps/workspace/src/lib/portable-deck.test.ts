import { describe, expect, it, vi } from 'vitest';
import { defaultDeckDesign, encodeVoiceWav, editableOutlineForOpenRoomFile, materializeOpenRoomFile, parseOpenRoomFile, stringifyOpenRoomFile, type Outline } from '@openroom/schema';
import { portableDeck } from './portable-deck';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const deck = (): Outline => ({ version: 1, meta: { title: 'Portable lesson' }, design: defaultDeckDesign(), interactions: [], steps: [
  { id: 'start', kind: 'title', title: 'Our workshop' },
] });

describe('portable cloud deck', () => {
  it('preserves unfilled template slots and online video without trying to download them', async () => {
    const source = deck();
    source.steps.push({ id: 'picture', kind: 'blank', elements: [{ id: 'image', type: 'image', alt: 'Choose a picture', box: { x: 5, y: 5, w: 90, h: 90 } }] },
      { id: 'listening', kind: 'media', media: { type: 'audio', url: 'https://local.openroom.invalid/openroom-pending-audio', alt: 'Choose a recording' } },
      { id: 'video', kind: 'media', media: { type: 'video', url: 'https://www.youtube.com/watch?v=lesson', alt: 'Video' } });
    const fetcher = vi.fn();
    const result = await portableDeck(source, 'https://openroom.test', fetcher);
    expect(result).toEqual({ outline: source, resources: {}, entries: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('packages shared design images once, plus audio and PDF, and retains both offline and cloud references', async () => {
    const source = deck();
    const image = { kind: 'image' as const, assetId: 'brand', url: '/api/assets/brand', focal: { x: 25, y: 70 }, overlay: { color: '#FFFFFF', opacity: 0.5 } };
    source.design!.masters[0]!.background = image;
    source.design!.masters[0]!.logo = { assetId: 'brand', url: '/api/assets/brand', alt: 'School' };
    source.steps[0]!.design = { background: image };
    source.steps.push({ id: 'listen', kind: 'media', media: { type: 'audio', assetId: 'audio', url: '/api/assets/audio', alt: 'Listening', listening: { mode: 'room' } } },
      { id: 'pages', kind: 'blank', elements: [{ id: 'pdf', type: 'pdf', assetId: 'pdf', url: '/api/assets/pdf', title: 'Practice', box: { x: 0, y: 0, w: 100, h: 100 } }] });
    const bytes = { brand: png, audio: encodeVoiceWav(new Float32Array(160)), pdf: new TextEncoder().encode('%PDF-1.4\n%%EOF') };
    const mock = vi.fn(async (url: string) => { const id = url.split('/').pop() as keyof typeof bytes; return new Response(new Uint8Array(bytes[id]), { headers: { 'content-type': { brand: 'image/png', audio: 'audio/wav', pdf: 'application/pdf' }[id] } }); });
    const portable = await portableDeck(source, 'https://openroom.test', mock as unknown as typeof fetch);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(Object.keys(portable.resources)).toHaveLength(3);
    expect(Object.keys(portable.entries)).toHaveLength(3);
    expect(portable.outline.design?.masters[0]?.background).toMatchObject({ resourceId: expect.any(String) });
    const file = { format: 'openroom-file' as const, fileVersion: 1 as const, fileId: '8946a4b4-4222-4d5f-99fa-748c0194e0c3', localRevision: 0, outline: portable.outline, resources: portable.resources };
    expect(parseOpenRoomFile(stringifyOpenRoomFile(file)).ok).toBe(true);
    expect(materializeOpenRoomFile(file)).toEqual({ ok: true, outline: source });
    expect(editableOutlineForOpenRoomFile(file).design?.masters[0]?.logo?.url).toMatch(/^https:\/\/local.openroom.invalid\//);
    for (const resource of Object.values(portable.resources)) expect(portable.entries[resource.path]).toEqual(bytes[resource.online!.assetId as keyof typeof bytes]);
  });

  it('rejects failed, oversized and mislabeled resources before producing a file', async () => {
    const source = deck();
    source.design!.masters[0]!.logo = { url: 'https://images.test/logo.png', alt: 'Logo' };
    await expect(portableDeck(source, 'https://openroom.test', (async () => new Response(null, { status: 404 })) as typeof fetch)).rejects.toThrow('HTTP 404');
    await expect(portableDeck(source, 'https://openroom.test', (async () => new Response('not a picture', { headers: { 'content-type': 'image/png' } })) as typeof fetch)).rejects.toThrow('declared format');
    await expect(portableDeck(source, 'https://openroom.test', (async () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) } })) as typeof fetch)).rejects.toThrow('size limit');
  });
});
