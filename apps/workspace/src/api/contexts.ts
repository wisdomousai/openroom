import type { ContextReturned } from '@openroom/editor';
import type { ContextKind, WorkspaceExperience, PublishedHomeworkTask, LearnerFeedback } from '@openroom/schema';
import { request } from './client';

/* --------------------------------------------------------------- tutoring */

export interface ContextSummary {
  id: string;
  spaceId: string;
  kind: ContextKind;
  displayName: string;
  nextNote?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ContextDetail extends ContextSummary {
  context: Record<string, unknown>;
  nextNote?: string;
}


export async function listContexts(options: {
  trash?: boolean;
  kind?: string;
} = {}): Promise<ContextSummary[]> {
  const query = new URLSearchParams();
  if (options.trash) query.set('trash', '1');
  if (options.kind) query.set('kind', options.kind);
  const qs = query.toString();
  const body = await request<{ contexts: ContextSummary[] }>(
    `/api/tutoring/contexts${qs ? `?${qs}` : ''}`,
  );
  return body.contexts ?? [];
}

export async function getContext(id: string): Promise<ContextDetail> {
  const body = await request<{ context: ContextDetail }>(
    `/api/tutoring/contexts/${encodeURIComponent(id)}`,
  );
  return body.context;
}

export async function createContext(input: {
  displayName: string;
  kind?: ContextKind;
  context?: Record<string, unknown>;
  sourceSpaceId?: string;
  experience?: WorkspaceExperience;
}): Promise<ContextDetail> {
  const body = await request<{ context: ContextDetail }>('/api/tutoring/contexts', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
  return body.context;
}

export async function updateContext(
  id: string,
  input: { displayName: string; kind?: ContextKind; context: Record<string, unknown> },
): Promise<ContextDetail> {
  const body = await request<{ context: ContextDetail }>(
    `/api/tutoring/contexts/${encodeURIComponent(id)}`,
    { method: 'PATCH', mutating: true, body: JSON.stringify(input) },
  );
  return body.context;
}

export function trashContext(id: string): Promise<{ ok: true; recoverable: true }> {
  return request(`/api/tutoring/contexts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    mutating: true,
  });
}

export function restoreContext(id: string): Promise<{ ok: true }> {
  return request(`/api/tutoring/contexts/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    mutating: true,
  });
}


/* ------------------------------------------------- context access links */

/**
 * What the tutor can ever see about a link after minting: enough to recognise
 * and revoke it, never enough to reconstruct it. `tokenPrefix` is the first 12
 * characters only.
 */
export interface ContextLinkSummary {
  id: string;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  learnerId: string;
  displayName: string;
}

/** The mint response — the only moment `token` exists outside the student's device. */
export interface MintedContextLink {
  learnerId: string;
  displayName: string;
  id: string;
  token: string;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface ContextLearner { id: string; displayName: string }
export async function listContextLearners(contextId: string): Promise<ContextLearner[]> {
  const body = await request<{ learners: ContextLearner[] }>(`/api/tutoring/contexts/${encodeURIComponent(contextId)}/learners`);
  return body.learners;
}

export async function listContextLinks(contextId: string): Promise<ContextLinkSummary[]> {
  const body = await request<{ links: ContextLinkSummary[] }>(
    `/api/tutoring/contexts/${encodeURIComponent(contextId)}/links`,
  );
  return body.links ?? [];
}

export function mintContextLink(
  contextId: string,
  input: { expiresInDays?: number; learnerId?: string; displayName?: string } = {},
): Promise<MintedContextLink> {
  return request<MintedContextLink>(
    `/api/tutoring/contexts/${encodeURIComponent(contextId)}/links`,
    { method: 'POST', mutating: true, body: JSON.stringify(input) },
  );
}

export function revokeContextLink(contextId: string, linkId: string): Promise<{ ok: true }> {
  return request(
    `/api/tutoring/contexts/${encodeURIComponent(contextId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE', mutating: true },
  );
}

export function getContextReturned(contextId: string): Promise<ContextReturned> {
  return request(`/api/tutoring/contexts/${encodeURIComponent(contextId)}/returned`);
}

export interface LearnerWork {
  id: string; learnerId: string; displayName: string; sessionId: string; taskId: string;
  task: PublishedHomeworkTask; body: string; assignmentRevision: number;
  audio?: { durationMs: number; available: boolean; recoverable?: boolean };
}
export interface LearnerWorkDetail {
  work: LearnerWork; earlier: LearnerWork[];
  feedback: { draft: LearnerFeedback | null; published: LearnerFeedback | null; version: number };
}
const workPath = (contextId: string) => `/api/tutoring/contexts/${encodeURIComponent(contextId)}/work`;
export async function listLearnerWork(contextId: string): Promise<LearnerWork[]> {
  return (await request<{ work: LearnerWork[] }>(workPath(contextId))).work;
}
export function getLearnerWork(contextId: string, submissionId: string): Promise<LearnerWorkDetail> {
  return request(`${workPath(contextId)}/${encodeURIComponent(submissionId)}`);
}
export function saveLearnerFeedback(contextId: string, submissionId: string, input: { feedback: LearnerFeedback; version: number; action: 'save' | 'publish' }): Promise<{ ok: true; version: number; published: LearnerFeedback | null }> {
  return request(`${workPath(contextId)}/${encodeURIComponent(submissionId)}/feedback`, { method: 'PUT', mutating: true, body: JSON.stringify(input) });
}
