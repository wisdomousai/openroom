import type { DictionaryEntry } from '@openroom/schema';
import { ApiError, request } from './client';

/* ------------------------------------------------- tutoring authoring tools */

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

export interface StockSearch {
  hits: StockHit[];
  totalHits: number;
  page: number;
  source?: string;
}

export function searchStock(query: string, page = 1): Promise<StockSearch> {
  const q = query.trim();
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return request(`/api/tutoring/stock${qs === '' ? '' : `?${qs}`}`);
}

/**
 * The tutor's word lookup.
 *
 * `scope` names the deck being edited or the session being run; the languages
 * come from that scope's space and are never sent from here. `unsupported`
 * says which half could not be served, so the panel can say so rather than
 * show a blank.
 */
export function lookupDictionary(input: {
  word: string;
  scope: { deckId: string } | { sessionCode: string };
}, signal?: AbortSignal): Promise<{
  entry: DictionaryEntry | null;
  meaning: string | null;
  unsupported?: 'language' | 'meaning-language';
}> {
  return request('/api/tutoring/dictionary', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
    signal,
  });
}

/**
 * The space a dictionary lookup could not serve because it has no language
 * pair, when the failure names one. `null` for every other failure, including
 * the other 422 this route can return (`invalid-word`) — which is why the
 * check is on the payload and not on the status alone.
 *
 * `canEdit` is the server's verdict on this caller. It gates whether the
 * console *offers* the fix; the write that applies it re-checks the role, so a
 * stale `true` here buys nothing.
 */
export function unconfiguredSpace(error: unknown): { spaceId: string; canEdit: boolean } | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  if (error.body === null || typeof error.body !== 'object') return null;
  const body = error.body as { error?: unknown; spaceId?: unknown; canEdit?: unknown };
  if (body.error !== 'languages-not-configured' || typeof body.spaceId !== 'string') return null;
  return { spaceId: body.spaceId, canEdit: body.canEdit === true };
}

/** Whether a page allows being framed, and what refused if it does not. */
export type EmbedCheck =
  | { embeddable: true }
  | { embeddable: false; reason: 'x-frame-options' | 'frame-ancestors' | 'unreachable' };

/**
 * Ask whether a page can be embedded.
 *
 * The browser cannot answer this for itself: a frame blocked by
 * `X-Frame-Options` fires `load`, not `error`, and its document is unreachable
 * across origins. So the check happens where the headers are visible.
 */
export function checkEmbeddable(input: { url: string; deckId: string }): Promise<EmbedCheck> {
  return request('/api/tutoring/embed-check', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
}

/** Fetch a page and convert it to Markdown the teacher reviews before inserting. */
export function importReadingMaterial(input: {
  url: string;
  deckId: string;
}): Promise<{ markdown: string; title: string }> {
  return request('/api/tutoring/embed-import', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
}
