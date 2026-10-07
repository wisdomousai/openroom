/**
 * The HTTP calls Desktop's file and present windows make.
 *
 * Same-origin paths: the main process proxies `openroom://app/api/…` to the
 * control plane, or, for a session it started on the teacher's relay, to that
 * relay (apps/desktop/src/relay.ts). Signed out, only the live session routes
 * and `/api/me` are reached; signed in, the file window also links, syncs and
 * starts decks through the control plane.
 *
 * Desktop is a peer client of the HTTP API (docs/CONTRACTS.md), like the CLI,
 * the MCP server and the Office add-in, and carries its own wrappers for the
 * routes it calls. Errors read the same way as the workspace's client, so a
 * start failure shows the same line in both.
 */
import type { DeckShape, MediaAssetSummary, Outline, PresentationPosition, SpaceSettings, SessionStatus } from '@openroom/schema';
import { mediaAssetPath } from '@openroom/schema';
import type {
  ApiErrorBody,
  DictionaryLookup,
  DictionaryLookupInput,
  EmbedCheck,
  ExportFormat,
  SessionContext,
  SessionError,
  StockSearch,
  StoredSession,
} from '@openroom/editor';

/* ------------------------------------------------------------------ client */

const baseUrl = ''; // same origin: openroom://app

export interface StartSessionResponse {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  joinUrl?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly errors: SessionError[];
  /** Raw parsed response body — structured error payloads (e.g. 409 conflicts). */
  readonly body: unknown;
  constructor(
    status: number,
    message: string,
    code?: string,
    errors: SessionError[] = [],
    body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.body = body;
  }
}

function extractErrors(body: ApiErrorBody | null): SessionError[] {
  if (!body) return [];
  if (Array.isArray(body.errors)) return body.errors;
  const err = body.error;
  if (err && typeof err === 'object') {
    const maybe = (err as { errors?: SessionError[] }).errors;
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}

function extractMessage(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error === 'object' && body.error.message) return body.error.message;
  if (body.message) return body.message;
  return fallback;
}

function extractCode(body: ApiErrorBody | null): string | undefined {
  if (!body) return undefined;
  if (body.error && typeof body.error === 'object' && body.error.code) return body.error.code;
  if (typeof body.code === 'string') return body.code;
  return undefined;
}

/** The CSRF header every cookie-authenticated mutation carries (docs/CONTRACTS.md §Auth and control plane). */
const CSRF_HEADERS = { 'x-openroom-csrf': '1' } as const;

async function request<T>(
  path: string,
  init: RequestInit & { mutating?: boolean } = {},
): Promise<T> {
  const { mutating, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined) headers.set('content-type', 'application/json');
  if (mutating) headers.set('x-openroom-csrf', '1');
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers,
    credentials: 'same-origin',
  });
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
      extractMessage(eb, `Request failed (HTTP ${res.status})`),
      extractCode(eb),
      extractErrors(eb),
      body,
    );
  }
  return body as T;
}

/* -------------------------------------------------------------------- auth */

export interface MeUser {
  id: string;
  email: string;
  name: string | null;
}

/** null = signed out. Never throws for the 401 case. */
export async function fetchMe(): Promise<MeUser | null> {
  try {
    const res = await fetch(`${baseUrl}/api/me`, { credentials: 'same-origin' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { user: MeUser };
    return body.user ?? null;
  } catch {
    return null;
  }
}

/** The worker's 403 code for a space owner without `continuity`. */
const CONTINUITY_REQUIRED = 'continuity-required';

/** Start/launch failures: a readable line for the identified-session 403. */
export function sessionStartMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.message === CONTINUITY_REQUIRED) return 'Identified sessions aren’t available in this space.';
  return cause instanceof Error ? cause.message : fallback;
}

/* ------------------------------------------------------------------- decks */

export interface DeckSummary {
  id: string;
  spaceId: string;
  folderId: string | null;
  contextId: string | null;
  title: string;
  shape: DeckShape;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface DeckDetailResponse {
  deck: DeckSummary;
  spaceName: string | null;
  folderName: string | null;
  contentVersion: number | null;
  contentHash: string | null;
  content: Outline | null;
}

export interface DeckFileLocation {
  deviceId: string;
  deviceName: string;
  path: string;
  localRevision: number;
  contentHash: string;
  syncedVersion: number;
  syncedHash: string;
  lastSeenAt: number;
}

export function getDeck(id: string, version?: number): Promise<DeckDetailResponse> {
  const query = version === undefined ? '' : `?version=${encodeURIComponent(String(version))}`;
  return request(`/api/decks/${encodeURIComponent(id)}${query}`);
}

export async function getDeckIfChanged(
  id: string,
  etag: string,
): Promise<{ changed: false; etag: string } | { changed: true; etag: string | null; detail: DeckDetailResponse }> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(id)}`, {
    headers: { 'if-none-match': etag },
    credentials: 'same-origin',
  });
  if (res.status === 304) return { changed: false, etag: res.headers.get('etag') ?? etag };
  const body = await res.json().catch(() => null) as (DeckDetailResponse & ApiErrorBody) | null;
  if (!res.ok || body?.deck === undefined) {
    throw new ApiError(res.status, extractMessage(body, `Request failed (HTTP ${res.status})`));
  }
  return { changed: true, etag: res.headers.get('etag'), detail: body };
}

export function createDeck(input: {
  title?: string;
  contextId?: string;
  folderId?: string | null;
  spaceId?: string | null;
  content?: Outline;
  fileId?: string;
}): Promise<{ deck: DeckSummary }> {
  return request('/api/decks', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
}

export function addDeckVersion(
  id: string,
  content: Outline,
  baseVersion: number,
  fileSync?: { fileId: string; localRevision: number; baseContentHash: string },
): Promise<{ deckId: string; version: number; contentHash: string; unchanged?: boolean }> {
  return request(`/api/decks/${encodeURIComponent(id)}/versions`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ content, baseVersion, ...(fileSync === undefined ? {} : { fileSync }) }),
  });
}

export function reportDeckFileLocation(
  id: string,
  deviceId: string,
  input: Omit<DeckFileLocation, 'deviceId' | 'lastSeenAt'> & { fileId: string },
): Promise<{ location: DeckFileLocation }> {
  return request(
    `/api/decks/${encodeURIComponent(id)}/file-locations/${encodeURIComponent(deviceId)}`,
    { method: 'PUT', mutating: true, body: JSON.stringify(input) },
  );
}

/* ------------------------------------------------- spaces, folders, people */

export type SpaceRole = 'owner' | 'editor' | 'presenter';

/** A space the caller can open — owned (`shared: false`) or joined. */
export interface MySpace {
  id: string;
  name: string;
  role: SpaceRole;
  shared: boolean;
  settings: SpaceSettings;
  createdAt: number;
  updatedAt: number;
}

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
}

export interface ContextSummary {
  id: string;
  spaceId: string;
  displayName: string;
}

export async function listAllSpaces(): Promise<MySpace[]> {
  const body = await request<{ spaces: MySpace[] }>('/api/my/spaces');
  return body.spaces ?? [];
}

/** The space's folders, for the place a linked file's online copy is saved in. */
export async function getSpaceTree(spaceId: string): Promise<{ folders: FolderSummary[] }> {
  const body = await request<{ folders?: FolderSummary[] }>(`/api/my/spaces/${encodeURIComponent(spaceId)}`);
  return { folders: body.folders ?? [] };
}

export async function listContexts(): Promise<ContextSummary[]> {
  const body = await request<{ contexts: ContextSummary[] }>('/api/tutoring/contexts');
  return body.contexts ?? [];
}

/* ---------------------------------------------------------------- sessions */

export interface SessionSummary {
  id: string;
  spaceId: string;
  folderId: string | null;
  deckId: string;
  deckVersion: number;
  contextId: string | null;
  title: string;
  shape: DeckShape;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export function getSessionItem(id: string): Promise<{ session: SessionSummary; canEdit: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(id)}`);
}

async function createSession(input: {
  deckId: string;
  deckVersion?: number;
  title?: string;
  contextId?: string;
  folderId?: string | null;
  spaceId?: string | null;
}): Promise<SessionSummary> {
  const body = await request<{ session: SessionSummary }>('/api/sessions', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
  return body.session;
}

function launchSession(id: string, options: { start?: boolean; version?: number; cursor?: PresentationPosition } = {}): Promise<{
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken: string;
  joinUrl?: string;
  sessionId: string;
  deckId: string;
  started?: boolean;
  startFailed?: string;
}> {
  return request(`/api/sessions/${encodeURIComponent(id)}/launch`, {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(options),
  });
}

/**
 * Start a linked file's online deck now, at the presenter's position: file a
 * session for the stamped version and launch it in the same call.
 */
export async function startSessionFromDeck(
  deck: Pick<DeckSummary, 'id' | 'title' | 'contextId' | 'currentVersion'>,
  place: { spaceId: string | null; folderId: string | null },
  cursor: PresentationPosition,
): Promise<StoredSession> {
  const session = await createSession({
    deckId: deck.id,
    deckVersion: deck.currentVersion,
    title: deck.title,
    ...(deck.contextId ? { contextId: deck.contextId } : {}),
    spaceId: place.spaceId,
    folderId: place.folderId,
  });
  const launched = await launchSession(session.id, { start: true, version: deck.currentVersion, cursor });
  if (launched.started === false) await startCreatedSession(launched.sessionCode, launched.hostToken, cursor);
  return {
    sessionCode: launched.sessionCode,
    code: launched.code,
    hostToken: launched.hostToken,
    stageToken: launched.stageToken,
    title: deck.title,
    ...(launched.joinUrl ? { joinUrl: launched.joinUrl } : {}),
    createdAt: Date.now(),
  };
}

export function startSessionFromOutline(outline: Outline): Promise<StartSessionResponse> {
  return request<StartSessionResponse>('/api/sessions', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify({ outline }),
  });
}

export async function uploadEphemeralSessionResource(
  sessionCode: string,
  hostToken: string,
  resourceId: string,
  contentType: string,
  sha256: string,
  bytes: Uint8Array,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/assets/${encodeURIComponent(resourceId)}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${hostToken}`,
        'content-type': contentType,
        'x-openroom-sha256': sha256,
      },
      body: Uint8Array.from(bytes).buffer,
    },
  );
  if (!response.ok) throw new ApiError(response.status, `Could not upload ${resourceId} (HTTP ${response.status})`);
}

export async function startCreatedSession(sessionCode: string, hostToken: string, cursor?: PresentationPosition): Promise<void> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${hostToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      command: { command: 'session.start', cursor },
    }),
  });
  if (!response.ok) throw new ApiError(response.status, `Could not start the session (HTTP ${response.status})`);
}

/** Fetch the authoritative host snapshot (used to recover the revision after a 409). */
export async function fetchHostSnapshot(sessionCode: string, hostToken: string): Promise<unknown> {
  const res = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/state?role=host`,
    { headers: { authorization: `Bearer ${hostToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(res.status, `Could not load session state (HTTP ${res.status})`);
  }
  return (await res.json()) as unknown;
}

/** Re-mint the projector token — a console recovered from a link has none stored. */
export async function fetchStageToken(sessionCode: string, hostToken: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/stage-token`, {
    headers: { authorization: `Bearer ${hostToken}` },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Could not fetch the stage link (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { stageToken?: string };
  if (typeof data.stageToken !== 'string') {
    throw new ApiError(res.status, 'Malformed stage-token response');
  }
  return data.stageToken;
}

/** What the session was launched for. Host token only — the answer names a person. */
export async function fetchSessionContext(sessionCode: string, hostToken: string): Promise<SessionContext> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/context`, {
    headers: { authorization: `Bearer ${hostToken}` },
  });
  if (!res.ok) throw new ApiError(res.status, `Could not load the session's context (HTTP ${res.status})`);
  return (await res.json()) as SessionContext;
}

/** Download the export with the host bearer token, via blob + synthetic anchor. */
export async function downloadExport(
  sessionCode: string,
  hostToken: string,
  format: ExportFormat,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/export?format=${format}`, {
    headers: { authorization: `Bearer ${hostToken}` },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const eb = body as ApiErrorBody | null;
    throw new ApiError(res.status, extractMessage(eb, `Export failed (HTTP ${res.status})`), extractCode(eb));
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `openroom-${sessionCode}.${format === 'json' ? 'json' : 'csv'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function joinUrlFor(code: string): string {
  const desktopOrigin = typeof window !== 'undefined' ? window.openroomDesktop?.controlOrigin : undefined;
  if (typeof desktopOrigin === 'string' && desktopOrigin !== '') {
    return `${desktopOrigin.replace(/\/$/, '')}/join/?code=${encodeURIComponent(code)}`;
  }
  return `${location.origin}/join/?code=${encodeURIComponent(code)}`;
}

/** True when `url` is a join link for the host we are currently on. */
function joinUrlMatchesEnvironment(url: URL): boolean {
  if (url.origin === location.origin) return true;
  const page = location.hostname;
  const join = url.hostname;
  const pageMarketing = page === 'openroom.app' || page === 'www.openroom.app';
  const pageJoin = page === 'join.openroom.app' || page.startsWith('join.');
  const targetJoin = join === 'join.openroom.app' || join.startsWith('join.');
  if (pageMarketing && targetJoin) return true;
  if (pageJoin && targetJoin) return true;
  return false;
}

/**
 * The join link for a session on the control plane. An absolute link the API
 * returns for another environment falls back to the control plane's `/join/`.
 */
export function resolveJoinUrl(code: string, serverJoinUrl?: string | null): string {
  const local = joinUrlFor(code);
  if (serverJoinUrl == null || serverJoinUrl === '') return local;
  try {
    const absolute = new URL(serverJoinUrl, location.origin);
    if (joinUrlMatchesEnvironment(absolute)) return absolute.toString();
    return local;
  } catch {
    return local;
  }
}

export function stageUrlFor(sessionCode: string, stageToken: string): string {
  return `${location.origin}/stage/?session=${encodeURIComponent(sessionCode)}&token=${encodeURIComponent(stageToken)}`;
}

/* ------------------------------------------------------------------ assets */

/** Where an uploaded asset is read from: same-origin and public, the unguessable id is the capability. */
export function assetUrl(assetId: string): string {
  return `${baseUrl}${mediaAssetPath(assetId)}`;
}

/** Upload one file to a space's media library. The body is the file itself. */
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

/* ------------------------------------------------------- authoring tools */

export function searchStock(query: string, page = 1): Promise<StockSearch> {
  const q = query.trim();
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return request(`/api/tutoring/stock${qs === '' ? '' : `?${qs}`}`);
}

/** The tutor's word lookup; the languages come from the scope's space. */
export function lookupDictionary(input: DictionaryLookupInput, signal?: AbortSignal): Promise<DictionaryLookup> {
  return request('/api/tutoring/dictionary', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
    signal,
  });
}

/** Whether a page can be embedded; checked where the headers are visible. */
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

