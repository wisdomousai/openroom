import { mediaAssetPath, type MediaAssetSummary } from '@openroom/schema';
import {
  ApiError,
  baseUrl,
  CSRF_HEADERS,
  extractCode,
  extractErrors,
  extractMessage,
  request,
} from './client';
import type { ApiErrorBody } from '@openroom/editor';
import { listAllSpaces } from './spaces';

export type { MediaAssetSummary };

/**
 * Where an uploaded asset is read from. Same-origin and public: the worker
 * treats the unguessable id as the capability so the stage and participant
 * surfaces can render the picture without a session (see worker src/assets.ts).
 */
export function assetUrl(assetId: string): string {
  return `${baseUrl}${mediaAssetPath(assetId)}`;
}

/**
 * Upload one file to a space's media library.
 *
 * The body is the file itself, not multipart: `File` already is a stream of
 * bytes with a type, and wrapping it in a form only to unwrap it server-side
 * buys nothing. Name and default alt text ride in the query string.
 */
export async function uploadAsset(
  spaceId: string,
  file: File,
  options: { alt?: string } = {},
): Promise<MediaAssetSummary> {
  const query = new URLSearchParams({ name: file.name });
  if (options.alt !== undefined && options.alt.trim() !== '') query.set('alt', options.alt.trim());
  const res = await fetch(
    `${baseUrl}/api/tutoring/spaces/${encodeURIComponent(spaceId)}/assets?${query.toString()}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': file.type === '' ? 'application/octet-stream' : file.type,
        ...CSRF_HEADERS,
      },
      body: file,
    },
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const eb = body as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      extractMessage(eb, `Upload failed (HTTP ${res.status})`),
      extractCode(eb),
      extractErrors(eb),
      body,
    );
  }
  return (body as { asset: MediaAssetSummary }).asset;
}

/** The space's uploaded files, newest first. `query` filters name and alt text. */
export async function listAssets(spaceId: string, query?: string): Promise<MediaAssetSummary[]> {
  const search = new URLSearchParams();
  if (query !== undefined && query.trim() !== '') search.set('query', query.trim());
  const qs = search.toString();
  const body = await request<{ assets: MediaAssetSummary[] }>(
    `/api/tutoring/spaces/${encodeURIComponent(spaceId)}/assets${qs === '' ? '' : `?${qs}`}`,
  );
  return body.assets ?? [];
}

/** Delete the bytes and the index row. Steps still pointing at it show their alt text. */
export function deleteAsset(assetId: string): Promise<{ ok: true }> {
  return request(`/api/tutoring/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    mutating: true,
  });
}

/**
 * The space to upload into when the caller has not been told one.
 *
 * The media library is opened from the deck editor, which today knows the deck
 * it is editing but not the space that deck lives in. Rather than guess, it
 * asks: the caller's own (non-shared) space, most recently touched first, which
 * is where a personal upload belongs.
 */
export async function defaultSpaceId(): Promise<string | null> {
  const spaces = await listAllSpaces();
  return (spaces.find((space) => !space.shared) ?? spaces[0])?.id ?? null;
}
