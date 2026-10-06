/**
 * Per-user interface preferences: one JSON blob on the `users` row.
 *
 * `GET /api/my/prefs` → `{ prefs }` · `PUT /api/my/prefs` replaces the whole
 * blob and answers with what was stored. There are deliberately no per-key
 * routes: preferences are read all at once by the shell and written whole, so
 * a key-addressed API would only add a merge race between two tabs without
 * making any read cheaper.
 *
 * ## What may live in here, and what may not
 *
 * Preferences are **how one person's interface is arranged** — which rows are
 * pinned to the shelf, which panel they left open. They are not business
 * records. Nothing here is authoritative, nothing here is shared, nothing here
 * is read by another user, and losing the whole blob costs a tutor thirty
 * seconds of re-pinning. If a value fails that test it is an entity and it
 * belongs in a table of its own.
 *
 * ## Validation is lenient on purpose
 *
 * A malformed preference must never be able to break the shell, and a client
 * from an older release must never have its whole blob rejected because it
 * carries a key this build does not know. So: unknown keys are preserved
 * verbatim, `pins` is *sanitised* rather than rejected (bad entries are
 * dropped, the good ones stored), and only two things are hard errors — a body
 * that is not a JSON object at all, and a blob over the size cap. Junk in
 * `pins` is a client bug; a 400 there would strand the user's other settings.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';

/**
 * Largest stored blob, measured on the serialised JSON.
 *
 * 8 KB is roughly two hundred pins' worth of text — far past any real shelf,
 * and small enough that the column never becomes a place to stash documents.
 */
export const MAX_PREFS_BYTES = 8 * 1024;

/**
 * Most pins one user may keep.
 *
 * The shelf sits under six nav items in a 208px rail. Past a dozen it stops
 * being "a few things I keep to hand" and becomes a second, unsorted library —
 * which is what the space tree already is, done properly.
 */
export const MAX_PINS = 12;

/** What a pin may point at, in **UI kind vocabulary** plus `folder`. */
export const PIN_KINDS = ['template', 'session', 'session', 'record', 'context', 'folder', 'space'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

const PIN_KIND_SET: ReadonlySet<string> = new Set(PIN_KINDS);

/** Longest label a pin may carry; the rail truncates well before this. */
const PIN_LABEL_MAX = 120;

export interface PinnedItem {
  kind: PinKind;
  id: string;
  label: string;
  /** Where the item lives, when the link needs it (a folder inside a space). */
  spaceId?: string;
}

function sanitisePin(value: unknown): PinnedItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== 'string' || !PIN_KIND_SET.has(row.kind)) return null;
  if (typeof row.id !== 'string' || row.id === '' || row.id.length > 128) return null;
  const label = typeof row.label === 'string' ? row.label.trim().slice(0, PIN_LABEL_MAX) : '';
  if (label === '') return null;
  const pin: PinnedItem = { kind: row.kind as PinKind, id: row.id, label };
  if (typeof row.spaceId === 'string' && row.spaceId !== '' && row.spaceId.length <= 128) {
    pin.spaceId = row.spaceId;
  }
  return pin;
}

/**
 * Drop what cannot be a pin, keep what can, cap the rest.
 *
 * Exported because the shape of a pin is a contract two clients share, and a
 * test that pins survive a round trip is more useful than a test that the
 * route returns 200.
 */
export function sanitisePins(value: unknown): PinnedItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const pins: PinnedItem[] = [];
  for (const raw of value) {
    const pin = sanitisePin(raw);
    if (pin === null) continue;
    const key = `${pin.kind}:${pin.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push(pin);
    if (pins.length >= MAX_PINS) break;
  }
  return pins;
}

/**
 * Sanitise a whole blob: known keys are checked, unknown keys pass through so
 * a newer client's settings survive a request made by an older one.
 */
export function sanitisePrefs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };
  if ('pins' in input) out.pins = sanitisePins(input.pins);
  return out;
}

function parseStored(raw: string | null): Record<string, unknown> {
  if (raw === null || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return sanitisePrefs(parsed);
  } catch {
    // A blob we cannot parse is a blob nobody can use. Answer with the empty
    // one rather than a 500: the next write repairs the row.
    return {};
  }
}

/** GET /api/my/prefs · PUT /api/my/prefs */
export async function prefsRoute(request: Request, env: ControlEnv): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'PUT') return json({ error: 'method-not-allowed' }, 405);

  const guard = await requireControlUser(request, env, method === 'PUT');
  if (!guard.ok) return guard.response;

  if (method === 'GET') {
    const row = await env.DB.prepare('SELECT prefs FROM users WHERE id = ?1')
      .bind(guard.user.id)
      .first<{ prefs: string | null }>();
    return json({ prefs: parseStored(row?.prefs ?? null) });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'prefs-must-be-object' }, 400);
  }
  // The blob a client sends is the blob it gets back; `prefs` is accepted as a
  // wrapper only so the PUT body mirrors the GET response.
  const source = 'prefs' in (body as Record<string, unknown>)
    ? (body as Record<string, unknown>).prefs
    : body;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return json({ error: 'prefs-must-be-object' }, 400);
  }
  const prefs = sanitisePrefs(source);
  const serialised = JSON.stringify(prefs);
  // Measured in bytes, not characters: an 8 KB cap that a non-Latin script can
  // exceed at a quarter of the length is not a cap, it is a surprise.
  if (new TextEncoder().encode(serialised).length > MAX_PREFS_BYTES) {
    return json({ error: 'prefs-too-large' }, 413);
  }
  await env.DB.prepare('UPDATE users SET prefs = ?1 WHERE id = ?2')
    .bind(serialised, guard.user.id)
    .run();
  return json({ prefs });
}
