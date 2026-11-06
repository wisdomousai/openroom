/**
 * Static asset headers from public/_headers, as the asset binding serves them.
 * The learner page (#/learn) lives in the workspace app under /host/ and
 * records voice responses, so that app must be allowed its own microphone
 * while every other page keeps it off.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'https://openroom.app';

async function policy(path: string): Promise<string | null> {
  const res = await SELF.fetch(`${BASE}${path}`, { redirect: 'manual' });
  await res.body?.cancel();
  if (res.status === 404) return null; // app dist not collected yet
  return res.headers.get('permissions-policy');
}

describe('Permissions-Policy', () => {
  it('lets the workspace app, which hosts the learner page, use its own microphone', async () => {
    const value = await policy('/host/');
    if (value === null) return;
    expect(value).toBe('geolocation=(), microphone=(self), camera=()');
  });

  it('keeps the microphone off on the public site', async () => {
    const value = await policy('/');
    if (value === null) return;
    expect(value).toBe('geolocation=(), microphone=(), camera=()');
  });
});
