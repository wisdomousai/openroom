/**
 * The sign-in gate tells a signed-out answer from a failed account check, and
 * a 401 from any workspace request sends the gate back to /api/me.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, onUnauthorized, request } from './api/client';
import { fetchMe, type AuthStatus, type MeUser } from './api/auth';
import { authState } from './useAuth';

afterEach(() => { vi.unstubAllGlobals(); onUnauthorized(null); });

const user: MeUser = { id: 'u1', email: 'host@example.com', name: null };
const methods: AuthStatus = { google: true, demo: false, accounts: [] };

describe('sign-in gate', () => {
  it('shows a failed account check as unreachable, never as signed out', async () => {
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    expect(await fetchMe().catch((cause: unknown) => cause)).toBeInstanceOf(ApiError);

    expect(authState({ data: undefined, isError: true }, { data: undefined, isError: false })).toEqual({ status: 'unreachable' });
    // Signed out with a failed method probe is unreachable, not "no sign-in method".
    expect(authState({ data: null, isError: false }, { data: undefined, isError: true })).toEqual({ status: 'unreachable' });
    expect(authState({ data: null, isError: false }, { data: methods, isError: false })).toEqual({ status: 'signed-out', methods });
    // A failed background recheck keeps the last answer.
    expect(authState({ data: user, isError: true }, { data: undefined, isError: false })).toEqual({ status: 'signed-in', user });
  });

  it('asks /api/me again when any request is refused with 401', async () => {
    const asked = vi.fn();
    onUnauthorized(asked);
    vi.stubGlobal('fetch', async () => Response.json({ error: 'unauthorized' }, { status: 401 }));
    await request('/api/my/spaces').catch(() => undefined);
    expect(asked).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', async () => Response.json({ error: 'forbidden' }, { status: 403 }));
    await request('/api/my/spaces').catch(() => undefined);
    expect(asked).toHaveBeenCalledTimes(1);
  });
});
