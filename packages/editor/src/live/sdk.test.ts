import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionThemeCommand, submitCommand } from './sdk';

describe('session.theme command', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the documented payload', () => {
    expect(sessionThemeCommand('projector')).toEqual({ command: 'session.theme', theme: 'projector' });
  });

  it('posts the envelope with expectedRevision and an idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, revision: 12 }), { status: 200 }),
      );
    });

    const outcome = await submitCommand(
      'ABCDEFGH',
      'host-token',
      sessionThemeCommand('paper'),
      11,
      'key-1',
    );

    expect(outcome).toEqual({ ok: true, revision: 12 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/sessions/ABCDEFGH/commands');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      idempotencyKey: 'key-1',
      command: { command: 'session.theme', theme: 'paper' },
      expectedRevision: 11,
    });
  });
});
