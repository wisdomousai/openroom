import type { SavedResultsDocument, SavedResultsFile } from '@openroom/schema';
import { request } from './client';

export interface ResultsScope { deckId?: string; sessionId?: string; sessionCode?: string }
export function listSavedResults(scope: ResultsScope, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ ...scope, ...(cursor ? { cursor } : {}) });
  return request<{ archives: SavedResultsFile[]; nextCursor?: string }>(`/api/my/archives?${query}`, { signal });
}
export const getSavedResults = (id: string, signal?: AbortSignal) => request<SavedResultsDocument>(`/api/my/archives/${encodeURIComponent(id)}/document`, { signal });
