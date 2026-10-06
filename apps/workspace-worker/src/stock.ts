/**
 * Tutor-only Pixabay search. Returns hosted picture URLs to embed on a slide.
 * The API key never leaves the Worker. Not a session command, not on the ballot path.
 */
import { json, type ControlEnv } from './auth.js';
import { requireControlUser } from './control-auth.js';

const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 60_000;
const STOCK_CACHE_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();
const stockCache = new Map<string, { body: unknown; until: number }>();

export interface StockHit {
  id: number;
  previewUrl: string;
  imageUrl: string;
  pageUrl: string;
  tags: string;
  user: string;
  width: number;
  height: number;
}

export const STOCK_PAGE_SIZE = 24;
/** Pixabay returns at most 500 hits per query; 24 × 21 = 504. */
export const STOCK_MAX_PAGE = 21;

export function parsePixabayHits(payload: unknown): StockHit[] {
  return parsePixabayResponse(payload).hits;
}

export function parsePixabayResponse(payload: unknown): { hits: StockHit[]; totalHits: number } {
  if (payload === null || typeof payload !== 'object') return { hits: [], totalHits: 0 };
  const body = payload as { hits?: unknown; totalHits?: unknown };
  if (!Array.isArray(body.hits)) return { hits: [], totalHits: 0 };
  const out: StockHit[] = [];
  for (const hit of body.hits) {
    if (typeof hit !== 'object' || hit === null) continue;
    const row = hit as Record<string, unknown>;
    const id = typeof row.id === 'number' ? row.id : Number(row.id);
    const webformat = typeof row.webformatURL === 'string' ? row.webformatURL : '';
    const preview = typeof row.previewURL === 'string' ? row.previewURL : '';
    const imageUrl =
      typeof row.largeImageURL === 'string'
        ? row.largeImageURL
        : webformat;
    const pageUrl = typeof row.pageURL === 'string' ? row.pageURL : '';
    if (!Number.isFinite(id) || imageUrl === '') continue;
    out.push({
      id,
      // Grid tiles need the 640px file; the 150px preview is unreadable in a picker.
      previewUrl: webformat || preview || imageUrl,
      imageUrl,
      pageUrl,
      tags: typeof row.tags === 'string' ? row.tags : '',
      user: typeof row.user === 'string' ? row.user : 'Pixabay',
      width: typeof row.imageWidth === 'number' ? row.imageWidth : 0,
      height: typeof row.imageHeight === 'number' ? row.imageHeight : 0,
    });
  }
  const totalHits =
    typeof body.totalHits === 'number' && Number.isFinite(body.totalHits)
      ? Math.max(0, Math.min(500, Math.trunc(body.totalHits)))
      : out.length;
  return { hits: out, totalHits };
}

export function stockPage(raw: string | null): number {
  const n = Number(raw ?? '1');
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, STOCK_MAX_PAGE);
}

function allow(userId: string, now: number): boolean {
  const current = buckets.get(userId);
  if (current === undefined || now >= current.resetAt) {
    // The map lives for the isolate's lifetime, so lapsed windows are swept
    // whenever one rolls over rather than accruing one entry per user forever.
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
    buckets.set(userId, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  if (current.count >= LOOKUP_LIMIT) return false;
  current.count += 1;
  return true;
}

export async function stockRoute(
  request: Request,
  env: ControlEnv & { PIXABAY_API_KEY?: string },
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const guard = await requireControlUser(request, env);
  if (!guard.ok) return guard.response;
  if (!allow(guard.user.id, now)) return json({ error: 'stock-rate-limited' }, 429);

  const key = env.PIXABAY_API_KEY?.trim() ?? '';
  if (key === '') return json({ error: 'stock-unconfigured' }, 501);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  // Empty q = popular browse (the picker opens onto a grid, not a blank field).
  // A single character is neither browse nor a real search.
  if (q.length === 1) return json({ error: 'invalid-query' }, 422);
  const page = stockPage(url.searchParams.get('page'));

  const pixabay = new URL('https://pixabay.com/api/');
  pixabay.searchParams.set('key', key);
  if (q.length >= 2) pixabay.searchParams.set('q', q);
  pixabay.searchParams.set('image_type', 'photo');
  pixabay.searchParams.set('safesearch', 'true');
  pixabay.searchParams.set('order', 'popular');
  pixabay.searchParams.set('per_page', String(STOCK_PAGE_SIZE));
  pixabay.searchParams.set('page', String(page));

  const cached = stockCache.get(`${q}\0${page}`);
  if (cached !== undefined && now < cached.until) {
    return json(cached.body);
  }

  try {
    const response = await fetchImpl(pixabay.toString(), {
      headers: {
        accept: 'application/json',
        'user-agent': 'OpenRoom/1.0 (https://openroom.app)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (cached !== undefined) return json(cached.body);
      return json({ error: 'stock-upstream' }, 502);
    }
    const payload: unknown = await response.json();
    const parsed = parsePixabayResponse(payload);
    const body = {
      hits: parsed.hits,
      totalHits: parsed.totalHits,
      page,
      source: 'Pixabay',
    };
    stockCache.set(`${q}\0${page}`, { body, until: now + STOCK_CACHE_MS });
    return json(body);
  } catch {
    if (cached !== undefined) return json(cached.body);
    return json({ error: 'stock-upstream' }, 502);
  }
}
