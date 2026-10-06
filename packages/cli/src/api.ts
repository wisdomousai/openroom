import type { Outline, OutlineStep } from '@openroom/schema';
import { isTutoringApiPath } from '@openroom/schema';

import { CliError } from './output.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CreateSessionResponse {
  sessionCode: string;
  code: string;
  hostToken: string;
  stageToken?: string;
  joinUrl?: string;
}

/** A host-visible command as accepted by POST /api/sessions/:sessionCode/commands. */
export type HostCommand =
  | { command: 'presentation.handoff'; facilitatorId: string }
  | { command: 'presentation.recover' }
  | { command: 'group.set'; group: { id: string; name: string; memberIds: string[]; spokespersonId: string | null } }
  | { command: 'group.remove'; groupId: string }
  | { command: 'session.start' }
  | { command: 'session.end' }
  | { command: 'session.freeze' }
  | { command: 'session.unfreeze' }
  | { command: 'session.advance' }
  | { command: 'outline.goto'; stepId: string }
  | { command: 'outline.next' }
  | { command: 'outline.previous' }
  | {
      command: 'outline.insert';
      step: OutlineStep;
      afterStepId?: string;
      show?: boolean;
    }
  | { command: 'session.theme'; theme: string }
  | { command: 'session.display'; display: string }
  | { command: 'timer.start' }
  | { command: 'timer.pause' }
  | { command: 'timer.reset' }
  | { command: 'timer.adjust'; seconds: number }
  | { command: 'interaction.open'; interactionId: string }
  | { command: 'interaction.close'; interactionId: string }
  | { command: 'interaction.reveal'; interactionId: string }
  | { command: 'interaction.hideResults'; interactionId: string }
  | { command: 'interaction.showResults'; interactionId: string }
  | { command: 'interaction.revote'; interactionId: string }
  | { command: 'interaction.undoRevote'; interactionId: string }
  | { command: 'text.hide'; interactionId: string; participantId: string }
  | { command: 'text.unhide'; interactionId: string; participantId: string };

export interface CommandEnvelope {
  idempotencyKey: string;
  command: HostCommand;
  expectedRevision?: number;
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new CliError(`invalid --url "${url}" (expected http:// or https:// base URL)`, {
      code: 'E_BAD_URL',
    });
  }
  return trimmed;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

async function readBody(res: Response): Promise<unknown> {
  if (res.ok && res.headers.get('content-type')?.split(';')[0] === 'audio/wav') {
    return { encoding: 'base64', mimeType: 'audio/wav', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
  }
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function describeFailure(res: Response, body: unknown): string {
  if (body !== null && typeof body === 'object') {
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string') return err;
    if (err !== null && typeof err === 'object') {
      const message = (err as { message?: unknown }).message;
      const code = (err as { code?: unknown }).code;
      if (typeof message === 'string') {
        return typeof code === 'string' ? `${code} ${message}` : message;
      }
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof body === 'string' && body !== '') return body.slice(0, 300);
  return `HTTP ${res.status} ${res.statusText}`;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const impl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (impl === undefined) {
      throw new CliError('global fetch is unavailable — Node 20+ is required', {
        code: 'E_NO_FETCH',
      });
    }
    this.fetchImpl = impl;
  }

  get base(): string {
    return this.baseUrl;
  }

  private async request(path: string, init: RequestInit): Promise<{ res: Response; body: unknown }> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (error) {
      throw new CliError(`request to ${url} failed: ${(error as Error).message}`, {
        code: 'E_NETWORK',
      });
    }
    const body = await readBody(res);
    if (!res.ok) {
      throw new CliError(`${init.method ?? 'GET'} ${path} → ${describeFailure(res, body)}`, {
        code: 'E_HTTP',
        status: res.status,
        body,
      });
    }
    return { res, body };
  }

  async createSession(outline: Outline, adminKey: string): Promise<CreateSessionResponse> {
    const { body } = await this.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openroom-admin': adminKey },
      body: JSON.stringify({ outline }),
    });
    const data = body as Partial<CreateSessionResponse> | null;
    if (data === null || typeof data.sessionCode !== 'string' || typeof data.hostToken !== 'string') {
      throw new CliError('POST /api/sessions returned an unexpected body (no sessionCode/hostToken)', {
        code: 'E_BAD_RESPONSE',
        body,
      });
    }
    return {
      sessionCode: data.sessionCode,
      code: typeof data.code === 'string' ? data.code : data.sessionCode,
      hostToken: data.hostToken,
      ...(typeof data.stageToken === 'string' ? { stageToken: data.stageToken } : {}),
      ...(typeof data.joinUrl === 'string' ? { joinUrl: data.joinUrl } : {}),
    };
  }

  async hostState(sessionCode: string, hostToken: string): Promise<Record<string, unknown>> {
    const { body } = await this.request(
      `/api/sessions/${encodeURIComponent(sessionCode)}/state?role=host`,
      { method: 'GET', headers: { authorization: `Bearer ${hostToken}` } },
    );
    if (body === null || typeof body !== 'object') {
      throw new CliError('state endpoint returned a non-object body', {
        code: 'E_BAD_RESPONSE',
        body,
      });
    }
    return body as Record<string, unknown>;
  }

  async sendCommand(
    sessionCode: string,
    hostToken: string,
    command: HostCommand,
  ): Promise<{ envelope: CommandEnvelope; result: unknown }> {
    const envelope: CommandEnvelope = { idempotencyKey: newIdempotencyKey(), command };
    const { body } = await this.request(`/api/sessions/${encodeURIComponent(sessionCode)}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hostToken}` },
      body: JSON.stringify(envelope),
    });
    return { envelope, result: body };
  }

  async facilitateSession(code: string, token: string): Promise<Record<string, unknown>> {
    const { body } = await this.request(`/api/my/sessions/${encodeURIComponent(code)}/facilitate`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    });
    return body as Record<string, unknown>;
  }

  async sessionRecap(code: string, hostToken: string, selection?: unknown): Promise<unknown> {
    const { body } = await this.request(`/api/sessions/${encodeURIComponent(code)}/recap`, {
      method: selection === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${hostToken}`, 'content-type': 'application/json' },
      ...(selection === undefined ? {} : { body: JSON.stringify(selection) }),
    });
    return body;
  }

  /**
   * User-scoped tutoring control-plane request. The CLI intentionally limits
   * this generic adapter to the same tutoring API namespace as the MCP tool;
   * browser-only permanent confirmation is therefore unreachable here.
   */
  async tutoringRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    // Keep allowlist in lockstep with @openroom/schema isTutoringApiPath / worker router.
    if (!isTutoringApiPath(path)) {
      throw new CliError('api path is outside /api/tutoring/contexts, /api/decks, and /api/sessions', {
        code: 'E_API_PATH',
        path,
      });
    }
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (body !== undefined && method !== 'GET') headers.set('content-type', 'application/json');
    const result = await this.request(path, {
      method,
      headers,
      ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.res.status, body: result.body };
  }

  /** Export needs the raw text (CSV as well as JSON), so it bypasses the JSON body reader. */
  async exportRaw(
    sessionCode: string,
    hostToken: string,
    format: 'csv' | 'json' | 'ballots',
  ): Promise<string> {
    const path = `/api/sessions/${encodeURIComponent(sessionCode)}/export?format=${format}`;
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${hostToken}` },
      });
    } catch (error) {
      throw new CliError(`request to ${url} failed: ${(error as Error).message}`, {
        code: 'E_NETWORK',
      });
    }
    const text = await res.text();
    if (!res.ok) {
      throw new CliError(`GET ${path} → HTTP ${res.status} ${res.statusText}`, {
        code: 'E_HTTP',
        status: res.status,
        body: text.slice(0, 300),
      });
    }
    return text;
  }
}
