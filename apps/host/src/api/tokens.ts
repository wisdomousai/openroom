import { request } from './client';

/* -------------------------------------------------------------- API tokens */

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface MintedApiToken extends ApiTokenSummary {
  /** Raw secret — only returned once at mint time. */
  token: string;
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const body = await request<{ tokens: ApiTokenSummary[] }>('/api/my/tokens');
  return body.tokens ?? [];
}

export function mintApiToken(name?: string): Promise<MintedApiToken> {
  return request<MintedApiToken>('/api/my/tokens', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(name !== undefined && name !== '' ? { name } : {}),
  });
}

export function revokeApiToken(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/my/tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    mutating: true,
  });
}

export interface MySession {
  code: string;
  sessionCode: string;
  title: string | null;
  createdAt: number;
  ended: boolean;
  recoverable: boolean;
  shared?: boolean;
  hostToken?: string;
  stageToken?: string;
}

export async function listMySessions(): Promise<MySession[]> {
  const body = await request<{ sessions: MySession[] }>('/api/my/sessions');
  return body.sessions ?? [];
}

export function facilitateSession(code: string): Promise<import('../types').StoredSession> {
  return request(`/api/my/sessions/${encodeURIComponent(code)}/facilitate`, { method: 'POST', mutating: true });
}
