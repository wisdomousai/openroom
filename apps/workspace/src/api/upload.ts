/**
 * POST a file with XMLHttpRequest, because fetch reports no upload progress.
 * `onProgress` receives the share of bytes sent, from 0 to 1. The promise
 * resolves with any HTTP status and its parsed JSON body (null when there is
 * none), and rejects on a network failure or when `signal` aborts.
 *
 * Same-origin XHR cannot omit cookies the way `credentials: 'omit'` does. The
 * learner routes that use this are dispatched before cookie auth, so the worker
 * never reads them there.
 */
export function postWithProgress(url: string, init: {
  headers: Record<string, string>;
  body: Blob;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('The upload was aborted.', 'AbortError');
    if (init.signal.aborted) { reject(aborted()); return; }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const settle = () => init.signal.removeEventListener('abort', abort);
    request.open('POST', url);
    for (const [name, value] of Object.entries(init.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total ? event.total : init.body.size;
      if (total) init.onProgress(Math.min(1, event.loaded / total));
    };
    request.onload = () => {
      settle();
      let body: unknown = null;
      try { body = request.responseText ? JSON.parse(request.responseText) : null; } catch { /* A non-JSON body is treated as none. */ }
      resolve({ status: request.status, body });
    };
    request.onerror = () => { settle(); reject(new TypeError('The upload did not reach the server.')); };
    request.onabort = () => { settle(); reject(aborted()); };
    init.signal.addEventListener('abort', abort, { once: true });
    request.send(init.body);
  });
}
