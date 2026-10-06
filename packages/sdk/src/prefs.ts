/**
 * Per-user interface preferences.
 *
 * One blob, read whole and written whole, at `GET|PUT /api/my/prefs`. The
 * browser, the CLI, MCP and a raw API caller reach the same route — there is
 * no browser-only preference store, because a shelf that exists on one device
 * and not another reads as data loss rather than as a setting.
 *
 * ## There is no per-key API, and that is deliberate
 *
 * `PUT` replaces the blob. A per-key route would look friendlier and would
 * quietly introduce a lost-update race between two tabs without making a
 * single read cheaper: the shell renders every preference on every page, so
 * nothing ever wants one key in isolation. Read, change, write back.
 *
 * ## Limits are mirrored, not enforced, here
 *
 * `MAX_PINS` and `MAX_PREFS_BYTES` describe what the server will do so a
 * client can disable an "Add pin" button before the round trip. The server
 * sanitises regardless: over-cap pins are dropped, an over-size blob is
 * refused with `413`. A client that ignores these constants gets the correct
 * outcome anyway.
 */
import type { FetchLike } from './client.js';

/** Largest stored blob, on the serialised JSON. */
export const MAX_PREFS_BYTES = 8 * 1024;

/** Most pins one user may keep on the shelf. */
export const MAX_PINS = 12;

/**
 * What a pin may point at.
 *
 * These are the **UI kind ids** (see `docs/TERMINOLOGY.md`), plus `folder` and
 * `space`, which are places rather than typed items. A pin is a link to somewhere the
 * user goes, so places belong in the list even though they are not library
 * kinds.
 */
export const PIN_KINDS = ['template', 'run', 'session', 'record', 'context', 'folder', 'space'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

/**
 * One shelf entry.
 *
 * `label` is stored rather than resolved on read: the shelf renders in the
 * nav rail on every page, and re-resolving five titles across five item types
 * to draw six links would cost more than the shelf saves. A stale label is a
 * cosmetic cost the user can fix by re-pinning; a fan-out on every navigation
 * is not.
 */
export interface PinnedItem {
  kind: PinKind;
  id: string;
  label: string;
  /** The space the item lives in, when the link needs it. */
  spaceId?: string;
}

/**
 * The known shape of the blob. Unknown keys survive a round trip untouched,
 * so an older client cannot wipe a newer one's settings.
 */
export interface UserPrefs extends Record<string, unknown> {
  pins?: PinnedItem[];
}

export interface PrefsClientOptions {
  /** Worker origin, e.g. `https://openroom.example`. */
  baseUrl: string;
  /**
   * Personal API token (`orpat_…`) or an MCP OAuth access token. Omit in a
   * browser, where the `or_session` cookie plus the CSRF header authenticates
   * instead — pass `credentials: 'include'` through `fetch` in that case.
   */
  token?: string;
  /** Testing seam; defaults to the global. */
  fetch?: FetchLike;
}

export interface PrefsClient {
  /** The whole blob. Never throws on an unset preference — absent is `{}`. */
  getPrefs(): Promise<UserPrefs>;
  /** Replace the whole blob; answers with what the server stored. */
  setPrefs(prefs: UserPrefs): Promise<UserPrefs>;
}

export class PrefsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PrefsError';
    this.status = status;
  }
}

export function createPrefsClient(options: PrefsClientOptions): PrefsClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const f: FetchLike =
    options.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);

  async function call(method: 'GET' | 'PUT', body?: unknown): Promise<UserPrefs> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      // A cookie-authenticated browser write needs the CSRF header; a bearer
      // token does not, and sending it anyway is harmless.
      headers['x-openroom-csrf'] = '1';
    }
    const res = await f(`${base}/api/my/prefs`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = (await res.json().catch(() => null)) as
      | { prefs?: UserPrefs; error?: string }
      | null;
    if (!res.ok) {
      throw new PrefsError(parsed?.error ?? `Prefs request failed (${res.status})`, res.status);
    }
    return parsed?.prefs ?? {};
  }

  return {
    getPrefs: () => call('GET'),
    setPrefs: (prefs) => call('PUT', { prefs }),
  };
}
