/**
 * `POST /api/tutoring/embed-check` and `POST /api/tutoring/embed-import`.
 *
 * Two console conveniences for the session editor, deliberately kept off the agent
 * surface (see the comment in `packages/schema/src/tutoring-paths.ts`).
 *
 * `embed-check` answers whether a page allows being framed. The session editor
 * cannot find this out for itself: a frame blocked by `X-Frame-Options` fires
 * `load`, not `error`, and its document is unreachable across origins. So the
 * teacher would otherwise discover a blank slide in front of a class.
 *
 * `embed-import` is the recovery. A page that refuses framing can still be read,
 * so it is fetched once and converted to Markdown the teacher reviews and puts
 * on a slide as reading material.
 *
 * ## These are the only routes in the product that fetch a caller-supplied URL
 *
 * Every other outbound call (`dictionary.ts`, `lookup.ts`, `stock.ts`,
 * `auth.ts`) targets a hostname that is a module constant, so the codebase has
 * no reusable SSRF guard — `embedTargetIssue` below is it. Two rules keep this
 * honest, and a change must not quietly drop either:
 *
 * 1. **Every hop is validated, not just the first.** Redirects are followed by
 *    hand (`redirect: 'manual'`) precisely so a public URL cannot bounce the
 *    fetch to a private one.
 * 2. **The guard runs before the fetch.** A rejected target must cost zero
 *    outbound requests, which is what the `seen` assertion in the tests pins.
 */
import { iframeUrlIssue } from '@openroom/schema';

import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { readJson } from './control-utils.js';
import { MAX_HTML_BYTES, pageToReadingMarkdown } from './markdown-negotiation.js';
import { spaceRole } from './members.js';

const EMBED_LIMIT = 20;
const EMBED_WINDOW_MS = 60_000;
const EMBED_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/**
 * A browser-ish agent string. Some publishers serve a different page — or none —
 * to an unrecognised client, and a probe that lies about framing is worse than
 * no probe. It names OpenRoom so an operator reading their logs can tell who called.
 */
const USER_AGENT =
  'Mozilla/5.0 (compatible; OpenRoom/1.0; +https://openroom.app/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(userId: string, now: number): boolean {
  const current = buckets.get(userId);
  if (current === undefined || now >= current.resetAt) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
    buckets.set(userId, { count: 1, resetAt: now + EMBED_WINDOW_MS });
    return true;
  }
  if (current.count >= EMBED_LIMIT) return false;
  current.count += 1;
  return true;
}

/** Hostnames that never name a public web page, whatever DNS says. */
const PRIVATE_SUFFIXES = ['.local', '.internal', '.home.arpa', '.localhost'];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Why this URL may not be fetched, or null when it may.
 *
 * Reuses `iframeUrlIssue` for the https-and-no-credentials rule so the route and
 * the element validator cannot disagree about what an embeddable address is.
 *
 * Hostname literals are refused outright rather than range-checked. Workers
 * resolve DNS at fetch time and give us no address to inspect, so a range check
 * here would be theatre; refusing the literal forms removes the cases an
 * attacker can actually aim, and a public name that resolves inward is not
 * reachable from Cloudflare's edge anyway.
 */
export function embedTargetIssue(value: string): string | null {
  const issue = iframeUrlIssue(value);
  if (issue !== null) return issue;
  const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost') return 'url must not be a local address';
  if (IPV4.test(host)) return 'url must name a host, not an IP address';
  if (host.startsWith('[') || host.includes(':')) return 'url must name a host, not an IP address';
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 'url must not be a local address';
  }
  if (!host.includes('.')) return 'url must name a public host';
  return null;
}

interface Hop {
  response: Response;
  url: string;
}

/**
 * Fetch, following redirects by hand so each hop is validated.
 *
 * Returns null when a hop is refused or the chain runs long — the caller cannot
 * distinguish the two, and should not: both mean "no page here".
 */
async function fetchChecked(target: string, fetchImpl: typeof fetch): Promise<Hop | null> {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (embedTargetIssue(url) !== null) return null;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) return null;
      await response.body?.cancel();
      try {
        url = new URL(location, url).toString();
      } catch {
        return null;
      }
      continue;
    }
    return { response, url };
  }
  return null;
}

export type EmbedRefusal = 'x-frame-options' | 'frame-ancestors' | 'unreachable';

/**
 * Read a framing verdict off the response headers.
 *
 * `frame-ancestors` overrides `X-Frame-Options` where both appear, which is the
 * order browsers apply them in. A `frame-ancestors` list is treated as a refusal
 * unless it is `*`: the list names origins, and OpenRoom is not going to be on
 * one that was written for somebody else's site.
 */
export function framingRefusal(headers: Headers): EmbedRefusal | null {
  const csp = headers.get('content-security-policy');
  const directive = csp === null ? null : /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(csp);
  if (directive !== null) {
    const sources = (directive[1] ?? '').trim().toLowerCase().split(/\s+/);
    return sources.includes('*') ? null : 'frame-ancestors';
  }
  const xfo = headers.get('x-frame-options');
  if (xfo !== null && /\b(?:deny|sameorigin|allow-from)\b/i.test(xfo)) return 'x-frame-options';
  return null;
}

/**
 * Membership at any role: reading a public page through us is a read.
 *
 * The scope is optional because an unsaved desktop file has no deck row to
 * name. It is not what makes this safe — the target guard and the per-user
 * budget are, and a signed-in tutor could fetch a public page from their own
 * browser regardless. When a deck *is* named it must be one the caller can
 * reach, so this cannot be used to probe against somebody else's session.
 */
async function guardScope(
  env: ControlEnv,
  user: Parameters<typeof spaceRole>[1],
  deckId: unknown,
): Promise<Response | null> {
  if (deckId === undefined || deckId === null || deckId === '') return null;
  if (typeof deckId !== 'string') return json({ error: 'not-found' }, 404);
  const row = await env.DB.prepare('SELECT space_id FROM decks WHERE id = ?1 AND deleted_at IS NULL')
    .bind(deckId)
    .first<{ space_id: string | null }>();
  const spaceId = row?.space_id ?? null;
  if (spaceId === null) return json({ error: 'not-found' }, 404);
  const access = await spaceRole(env, user, spaceId);
  if (access === null) return json({ error: 'not-found' }, 404);
  return null;
}

export async function embedCheckRoute(
  request: Request,
  env: ControlEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  if (!allow(guard.user.id, now)) return json({ error: 'embed-rate-limited' }, 429);

  const body = (await readJson(request)) ?? {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const issue = url === '' ? 'url is required' : embedTargetIssue(url);
  if (issue !== null) return json({ error: 'invalid-url', message: issue }, 422);

  const denied = await guardScope(env, guard.user, body.deckId);
  if (denied !== null) return denied;

  const hop = await fetchChecked(url, fetchImpl);
  if (hop === null) return json({ embeddable: false, reason: 'unreachable' satisfies EmbedRefusal });
  await hop.response.body?.cancel();
  if (!hop.response.ok) return json({ embeddable: false, reason: 'unreachable' satisfies EmbedRefusal });

  const refusal = framingRefusal(hop.response.headers);
  return json(refusal === null ? { embeddable: true } : { embeddable: false, reason: refusal });
}

/** Read at most `MAX_HTML_BYTES`, then stop pulling. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      size += value.byteLength;
      if (size >= MAX_HTML_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined.subarray(0, MAX_HTML_BYTES));
}

export async function embedImportRoute(
  request: Request,
  env: ControlEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  if (!allow(guard.user.id, now)) return json({ error: 'embed-rate-limited' }, 429);

  const body = (await readJson(request)) ?? {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const issue = url === '' ? 'url is required' : embedTargetIssue(url);
  if (issue !== null) return json({ error: 'invalid-url', message: issue }, 422);

  const denied = await guardScope(env, guard.user, body.deckId);
  if (denied !== null) return denied;

  const hop = await fetchChecked(url, fetchImpl);
  if (hop === null || !hop.response.ok) return json({ error: 'page-unreachable' }, 422);
  const contentType = hop.response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) {
    await hop.response.body?.cancel();
    return json({ error: 'page-not-html' }, 422);
  }

  const html = await readCapped(hop.response);
  const { title, markdown } = pageToReadingMarkdown(html);
  if (markdown.trim() === '') return json({ error: 'page-empty' }, 422);
  return json({ markdown, title: title ?? '' });
}
