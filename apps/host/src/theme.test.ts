import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMode, swatchColors } from './lib/theme';
import { sessionThemeCommand } from './sdk';
import { submitCommand } from './sdk';

describe('theme helpers', () => {
  it('collapses the system mode setting against the OS preference', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });

  it('builds a swatch row from the theme tokens', () => {
    const swatches = swatchColors('sherbet', 'light');
    expect(swatches).toHaveLength(6);
    for (const colour of swatches) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(swatchColors('sherbet', 'dark')).not.toEqual(swatches);
  });
});

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
