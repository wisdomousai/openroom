/** Local capacity instrumentation. Production and browser verification use the original entry. */
import worker from '../apps/worker/src/index.ts';
export * from '../apps/worker/src/index.ts';

export default {
  ...worker,
  async fetch(request, env, ctx) {
    const started = performance.now();
    const response = await worker.fetch(request, env, ctx);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set('server-timing', `openroom;dur=${(performance.now() - started).toFixed(3)}`);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
