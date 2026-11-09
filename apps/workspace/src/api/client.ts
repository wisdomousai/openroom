import type { ApiErrorBody, SessionError } from '@openroom/editor';

export const baseUrl = ''; // same origin (docs/CONTRACTS.md §HTTP API)

/** Shared deletion-envelope for every permanent-deletion route. */
export interface DeletionIntent {
  ok: true;
  confirmationRequired: true;
  expiresAt: number;
  confirmationUrl: string;
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

/** The code an ApiError carries when the request never reached the worker. */
export const NETWORK_ERROR = 'network-error';
export const OFFLINE_MESSAGE = 'OpenRoom could not be reached. Check your connection and try again.';

/**
 * The worker answers failures with a code (`{ error: 'stock-unconfigured' }`).
 * This is the one place a code becomes a sentence a tutor reads, so no screen
 * and no editor dialog prints a slug. The code stays on `ApiError.code` for
 * callers that branch on it.
 */
const ERROR_SENTENCES: Record<string, string> = {
  'not-found': 'This item no longer exists or is not shared with you.',
  'deck-not-found': 'This deck no longer exists or is not shared with you.',
  'session-not-found': 'This session no longer exists or is not shared with you.',
  'student-not-found': 'This student no longer exists or is not shared with you.',
  'folder-not-found': 'This folder no longer exists.',
  'brand-kit-not-found': 'This brand kit no longer exists.',
  forbidden: 'You do not have permission to do this here.',
  unauthorized: 'Sign in again to continue.',
  'csrf-required': 'Reload the page and try again.',
  'invalid-json': 'The request could not be read. Reload the page and try again.',
  'invalid-body': 'The request could not be read. Reload the page and try again.',
  'invalid-credentials': 'Username or password is incorrect.',
  'resource-in-trash': 'This item is in Trash. Restore it first.',
  'brand-kit-in-trash': 'This brand kit is in Trash. Restore it first.',
  'move-to-trash-first': 'Move this item to Trash before deleting it permanently.',
  'confirmation-expired': 'This confirmation link no longer works. Ask for a new one.',
  'version-conflict': 'This deck was saved somewhere else. Reload to see the latest version.',
  'session-version-conflict': 'This deck was saved somewhere else. Reload to see the latest version.',
  'session-already-ended': 'This session has ended.',
  'session-already-live': 'This session is already live.',
  'session-quota': 'You have started as many sessions as a day allows. Try again later.',
  'title-required': 'Enter a title.',
  'display-name-required': 'Enter a name.',
  'invalid-email': 'Enter a valid email address.',
  'already-member': 'This person is already a member.',
  'already-invited': 'This person is already invited.',
  'self-invite': 'You cannot invite yourself.',
  'team-required': 'Invitations and shared workspaces require a Tutoring licence.',
  'stock-unconfigured': 'Stock photos are not set up for this workspace.',
  'stock-rate-limited': 'Too many stock photo searches just now. Try again in a minute.',
  'stock-upstream': 'The stock photo service did not answer. Try again in a minute.',
  'asset-too-large': 'This file is too large to upload.',
  'unsupported-media-type': 'This file type cannot be uploaded here.',
  'unsupported-audio': 'Choose an MP3, WAV or M4A recording.',
  'audio-too-large': 'This recording is too large to upload.',
  'payload-too-large': 'This is too large to save.',
  'draft-too-large': 'This deck is too large to save.',
  'presentation-too-large': 'This deck is too large to start.',
  'lookup-rate-limited': 'Too many lookups just now. Try again in a minute.',
  'embed-rate-limited': 'Too many pages read just now. Try again in a minute.',
  'languages-not-configured': 'No language pair is set. Set one in Space settings.',
  'unsupported-language-pair': 'Word lookup does not support this language pair.',
};

/**
 * Codes a screen still matches on `message` to supply its own wording. They
 * pass through as codes until those screens read `code` instead.
 */
const MATCHED_BY_MESSAGE = new Set([
  'continuity-required',
  'correction-not-in-submission',
  'invalid-homework-audience',
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$|^[a-z]+$|^E_[A-Z_]+$/;

/** A sentence for a failure the table does not name, from its HTTP status. */
export function statusSentence(status: number): string {
  if (status === 0) return OFFLINE_MESSAGE;
  if (status === 401) return ERROR_SENTENCES.unauthorized!;
  if (status === 403) return ERROR_SENTENCES.forbidden!;
  if (status === 404) return ERROR_SENTENCES['not-found']!;
  if (status === 409) return 'This changed somewhere else. Reload and try again.';
  if (status === 413) return ERROR_SENTENCES['payload-too-large']!;
  if (status === 429) return 'Too many requests just now. Try again in a minute.';
  if (status >= 500) return 'OpenRoom could not finish this. Try again.';
  return 'This request could not be completed.';
}

/** The sentence for a worker code; a text that is already a sentence is kept. */
export function errorSentence(text: string, status: number): string {
  if (MATCHED_BY_MESSAGE.has(text)) return text;
  const known = ERROR_SENTENCES[text];
  if (known) return known;
  return SLUG.test(text) ? statusSentence(status) : text;
}

export function extractErrors(body: ApiErrorBody | null): SessionError[] {
  if (!body) return [];
  if (Array.isArray(body.errors)) return body.errors;
  const err = body.error;
  if (err && typeof err === 'object') {
    const maybe = (err as { errors?: SessionError[] }).errors;
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}

/**
 * What the tutor reads. With `status`, a code becomes a sentence and a missing
 * message becomes the status sentence rather than `fallback`.
 */
export function extractMessage(body: ApiErrorBody | null, fallback: string, status?: number): string {
  const raw = !body ? undefined
    : typeof body.error === 'string' ? body.error
      : body.error && typeof body.error === 'object' && body.error.message ? body.error.message
        : body.message;
  if (status === undefined) return raw ?? fallback;
  return raw ? errorSentence(raw, status) : statusSentence(status);
}

export function extractCode(body: ApiErrorBody | null): string | undefined {
  if (!body) return undefined;
  if (body.error && typeof body.error === 'object' && body.error.code) return body.error.code;
  if (typeof body.code === 'string') return body.code;
  if (typeof body.error === 'string' && SLUG.test(body.error)) return body.error;
  return undefined;
}

/** The ApiError for a failed response, with its sentence and code. */
export function responseError(status: number, body: unknown): ApiError {
  const eb = body as ApiErrorBody | null;
  return new ApiError(status, extractMessage(eb, '', status), extractCode(eb), extractErrors(eb), body);
}

/**
 * `fetch`, with a failure to reach the worker raised as an ApiError the
 * editor's `isServiceError` recognises, so "offline" is never reported as the
 * server's or a third party's fault. An abort still rejects as an abort.
 */
export async function apiFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    if (cause instanceof TypeError) throw new ApiError(0, OFFLINE_MESSAGE, NETWORK_ERROR);
    throw cause;
  }
}

/**
 * The CSRF header every cookie-authenticated mutation must carry.
 * `SameSite=Lax` already blocks cross-site POSTs; this is defence in depth
 * (docs/CONTRACTS.md §Auth and control plane).
 */
export const CSRF_HEADERS = { 'x-openroom-csrf': '1' } as const;

let unauthorizedHandler: (() => void) | null = null;

/**
 * The one place a refused cookie reaches the sign-in gate. The host registers
 * a handler that asks `/api/me` again, so a 401 from any workspace call moves
 * the gate to signed out when the sign-in has expired.
 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** The ApiError for a failed workspace response; a 401 also tells the gate. */
export function failedResponse(status: number, body: unknown): ApiError {
  if (status === 401) unauthorizedHandler?.();
  return responseError(status, body);
}

export async function request<T>(
  path: string,
  init: RequestInit & { mutating?: boolean } = {},
): Promise<T> {
  const { mutating, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined) headers.set('content-type', 'application/json');
  if (mutating) headers.set('x-openroom-csrf', '1');
  const res = await apiFetch(`${baseUrl}${path}`, {
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
  if (!res.ok) throw failedResponse(res.status, body);
  return body as T;
}
