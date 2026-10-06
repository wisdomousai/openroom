import { describe, expect, it } from 'vitest';
import { localResourceResponse } from './resource-response.js';
const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
const get = (range?: string, method = 'GET') => localResourceResponse(new Request('https://local.openroom.invalid/audio', { method, headers: range ? { range } : {} }), bytes, 'audio/wav');
describe('portable audio ranges', () => {
  it('serves whole, partial, suffix and HEAD responses with matching lengths', async () => {
    expect(get().headers.get('content-type')).toBe('audio/wav');
    const middle = get('bytes=2-4');
    expect(middle.status).toBe(206);
    expect(middle.headers.get('content-range')).toBe('bytes 2-4/6');
    expect([...new Uint8Array(await middle.arrayBuffer())]).toEqual([2, 3, 4]);
    expect([...new Uint8Array(await get('bytes=-2').arrayBuffer())]).toEqual([4, 5]);
    const head = get('bytes=4-', 'HEAD');
    expect(head.headers.get('content-length')).toBe('2');
    expect(await head.text()).toBe('');
  });
  it('rejects malformed and unsatisfiable ranges without returning bytes', async () => {
    for (const range of ['bytes=-0', 'bytes=6-', 'bytes=4-2', 'bytes=-', 'bytes=0-1,4-5']) {
      const response = get(range);
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */6');
      expect(await response.text()).toBe('');
    }
  });
});
