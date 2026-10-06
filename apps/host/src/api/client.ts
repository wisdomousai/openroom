import type { ApiErrorBody, SessionError } from '../../../../packages/editor/src/types';

export const baseUrl = ''; // same origin (docs/CONTRACTS.md §HTTP API)

/** Shared deletion-envelope for every permanent-deletion route. */
export interface DeletionIntent {
  ok: true;
  confirmationRequired: true;
  expiresAt: number;
  confirmationUrl: string;
}

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

export function extractMessage(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error === 'object' && body.error.message) return body.error.message;
  if (body.message) return body.message;
  return fallback;
}

export function extractCode(body: ApiErrorBody | null): string | undefined {
  if (!body) return undefined;
  if (body.error && typeof body.error === 'object' && body.error.code) return body.error.code;
  if (typeof body.code === 'string') return body.code;
  return undefined;
}

/**
 * The CSRF header every cookie-authenticated mutation must carry.
 * `SameSite=Lax` already blocks cross-site POSTs; this is defence in depth
 * (docs/CONTRACTS.md §Auth and control plane).
 */
export const CSRF_HEADERS = { 'x-openroom-csrf': '1' } as const;

export async function request<T>(
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
