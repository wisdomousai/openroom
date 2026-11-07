/**
 * The learner's voice upload shows how much of the recording has been sent,
 * and a timeout or page exit still cancels it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { postWithProgress } from './upload';

class FakeRequest {
  static last: FakeRequest;
  headers: Record<string, string> = {};
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  sent: unknown = null;
  constructor() { FakeRequest.last = this; }
  open() {}
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.sent = body; }
  abort() { this.onabort?.(); }
  respond(status: number, text: string) { this.status = status; this.responseText = text; this.onload?.(); }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('postWithProgress', () => {
  it('reports the share of bytes sent and resolves with the status and JSON body', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const progress: number[] = [];
    const body = new Blob([new Uint8Array(200)]);
    const pending = postWithProgress('/api/learner/voice', { headers: { authorization: 'Bearer t' }, body, signal: new AbortController().signal, onProgress: (value) => progress.push(value) });
    const request = FakeRequest.last;
    expect(request.headers.authorization).toBe('Bearer t');
    expect(request.sent).toBe(body);
    request.upload.onprogress?.({ loaded: 50, total: 200, lengthComputable: true });
    // Without a computable total the body size stands in.
    request.upload.onprogress?.({ loaded: 150, total: 0, lengthComputable: false });
    request.respond(201, '{"submissionId":"s1","durationMs":4000}');
    await expect(pending).resolves.toEqual({ status: 201, body: { submissionId: 's1', durationMs: 4000 } });
    expect(progress).toEqual([0.25, 0.75]);
  });

  it('resolves an error status with a null body when the response is not JSON', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const pending = postWithProgress('/x', { headers: {}, body: new Blob(['a']), signal: new AbortController().signal, onProgress: () => {} });
    FakeRequest.last.respond(502, '<html>Bad gateway</html>');
    await expect(pending).resolves.toEqual({ status: 502, body: null });
  });

  it('cancels the request when the signal aborts, as the size-scaled timeout does', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const controller = new AbortController();
    const pending = postWithProgress('/x', { headers: {}, body: new Blob(['a']), signal: controller.signal, onProgress: () => {} });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects on a network failure', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const pending = postWithProgress('/x', { headers: {}, body: new Blob(['a']), signal: new AbortController().signal, onProgress: () => {} });
    FakeRequest.last.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });
});
