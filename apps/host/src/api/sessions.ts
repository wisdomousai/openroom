import type { HomeworkAudience } from '@openroom/schema';
import type { DeckShape, Outline, PresentationPosition, SessionStatus } from '@openroom/schema';
import type { ApiErrorBody, ExportFormat, SessionContext } from '@openroom/editor';
import {
  ApiError,
  baseUrl,
  extractCode,
  extractMessage,
  request,
  type DeletionIntent,
  type StartSessionResponse,
} from './client';

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

export async function listSessions(options: {
  trash?: boolean;
  deckId?: string;
  contextId?: string;
  folderId?: string;
  spaceId?: string;
} = {}): Promise<SessionSummary[]> {
  const query = new URLSearchParams();
  if (options.trash) query.set('trash', '1');
  if (options.deckId) query.set('deckId', options.deckId);
  if (options.contextId) query.set('contextId', options.contextId);
  if (options.folderId !== undefined) query.set('folderId', options.folderId);
  if (options.spaceId) query.set('spaceId', options.spaceId);
  const qs = query.toString();
  const body = await request<{ sessions: SessionSummary[] }>(`/api/sessions${qs ? `?${qs}` : ''}`);
  return body.sessions ?? [];
}

export function getSessionItem(id: string): Promise<{ session: SessionSummary; canEdit: boolean }> {
  return request(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function createSession(input: {
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

export function trashSession(id: string): Promise<{ ok: true; recoverable: true }> {
  return request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', mutating: true });
}

export function restoreSession(id: string): Promise<{ ok: true }> {
  return request(`/api/sessions/${encodeURIComponent(id)}/restore`, { method: 'POST', mutating: true });
}

export async function launchSession(id: string, options: { start?: boolean; version?: number; cursor?: PresentationPosition } = {}): Promise<{
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

export interface SessionRecord {
  id: string;
  sessionId: string;
  contextId: string | null;
  sessionCode: string | null;
  deckVersion: number;
  outcomes: unknown[];
  notes: string;
  nextNote?: string;
  homework: unknown[];
  homeworkAudience?: HomeworkAudience;
  homeworkRevision: number;
  artifacts: unknown[];
  createdAt: number;
  updatedAt: number;
}

export async function getSessionRecord(sessionId: string): Promise<SessionRecord | null> {
  const body = await request<{ record: SessionRecord | null }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/record`,
  );
  return body.record;
}

export function saveSessionRecord(
  sessionId: string,
  input: {
    outcomes: unknown[];
    notes: string;
    nextNote?: string;
    homework: unknown[];
  homeworkAudience?: HomeworkAudience;
    homeworkRevision?: number;
    artifacts: unknown[];
  },
): Promise<{ ok: true }> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/record`, {
    method: 'PUT',
    mutating: true,
    body: JSON.stringify(input),
  });
}

export function requestPermanentDeletion(
  type: 'context' | 'deck' | 'session',
  id: string,
): Promise<DeletionIntent> {
  const base =
    type === 'context'
      ? `/api/tutoring/contexts/${encodeURIComponent(id)}`
      : type === 'deck'
        ? `/api/decks/${encodeURIComponent(id)}`
        : `/api/sessions/${encodeURIComponent(id)}`;
  return request(`${base}/permanent-deletion`, {
    method: 'POST',
    mutating: true,
  });
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

/**
 * The console's mode is derived from this, not from a control: a session either
 * came from a run with a context (tutoring) or it did not (shared). Host token
 * only — the answer names a person.
 */
export async function fetchSessionContext(sessionCode: string, hostToken: string): Promise<SessionContext> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/context`, {
    headers: { authorization: `Bearer ${hostToken}` },
  });
  if (!res.ok) throw new ApiError(res.status, `Could not load the session's context (HTTP ${res.status})`);
  return (await res.json()) as SessionContext;
}

export function exportUrl(sessionCode: string, format: ExportFormat): string {
  return `${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/export?format=${format}`;
}

/** Download the export with the host bearer token, via blob + synthetic anchor. */
export async function downloadExport(
  sessionCode: string,
  hostToken: string,
  format: ExportFormat,
): Promise<void> {
  const res = await fetch(exportUrl(sessionCode, format), {
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

export function joinUrlFor(code: string): string {
  const desktopOrigin = typeof window !== 'undefined' ? window.openroomDesktop?.controlOrigin : undefined;
  if (typeof desktopOrigin === 'string' && desktopOrigin !== '') {
    return `${desktopOrigin.replace(/\/$/, '')}/join/?code=${encodeURIComponent(code)}`;
  }
  const host = location.hostname;
  if (host === 'openroom.app' || host === 'www.openroom.app') {
    return `https://join.openroom.app/?code=${encodeURIComponent(code)}`;
  }
  if (host === 'join.openroom.app' || host.startsWith('join.')) {
    return `${location.origin}/?code=${encodeURIComponent(code)}`;
  }
  // Local wrangler / workers.dev: join SPA is path-mounted at /join/.
  return `${location.origin}/join/?code=${encodeURIComponent(code)}`;
}

/**
 * Resolve a join link for the current page.
 *
 * The API may still return an absolute production `join.openroom.app` URL when
 * JOIN_ORIGIN is set (wrangler.jsonc). On local / preview hosts that would
 * send the tutor out of this environment — prefer the same-origin `/join/` SPA.
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

/** True when `url` is a join link for the host we are currently on. */
function joinUrlMatchesEnvironment(url: URL): boolean {
  if (url.origin === location.origin) return true;
  const page = location.hostname;
  const join = url.hostname;
  const pageMarketing = page === 'openroom.app' || page === 'www.openroom.app';
  const pageJoin = page === 'join.openroom.app' || page.startsWith('join.');
  const targetJoin = join === 'join.openroom.app' || join.startsWith('join.');
  // Production marketing host legitimately points at the join subdomain.
  if (pageMarketing && targetJoin) return true;
  if (pageJoin && targetJoin) return true;
  return false;
}

export function stageUrlFor(sessionCode: string, stageToken: string): string {
  return `${location.origin}/stage/?session=${encodeURIComponent(sessionCode)}&token=${encodeURIComponent(stageToken)}`;
}
