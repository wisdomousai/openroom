import { ApiError, baseUrl } from './client';
import type { HomeworkPracticeInteraction, LearnerFeedback, PublishedHomeworkTask } from '@openroom/schema';

/* ----------------------------------------------------------- learner side */

export interface LearnerIdentity {
  contextId: string;
  displayName: string;
}

export interface LearnerHomeworkTask {
  id: string;
  kind: 'reading' | 'writing' | 'voice' | 'quiz';
  title?: string;
  body?: string;
  prompt?: string;
  guidance?: string;
  submitted?: string;
  audio?: { submissionId: string; durationMs: number; available: boolean; recoverable?: boolean };
  assignmentRevision?: number;
  interaction?: HomeworkPracticeInteraction;
}

export interface LearnerSessionRecord {
  outcomes: unknown[];
  homework: LearnerHomeworkTask[] | unknown[];
  artifacts: unknown[];
}

export interface LearnerPracticeItem {
  itemId: string;
  assignmentRevision: number;
  title?: string;
  interaction: HomeworkPracticeInteraction;
}

export interface LearnerSession {
  id: string;
  title: string;
  status: string;
  record?: LearnerSessionRecord;
}

/**
 * `/api/learner/*` is authenticated by the link and nothing else. Cookies are
 * deliberately omitted: a tutor who opens their own student's link in the same
 * browser must get the student's view, not a session-flavoured one, and the
 * server must never be able to fall back to a cookie for these reads.
 */
async function learnerRequest<T>(
  path: string,
  token: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    credentials: 'omit',
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    // The message never carries the token or the server's error string through
    // to the page: the learner screen decides its own calm wording from status.
    throw new ApiError(res.status, `Request failed (HTTP ${res.status})`);
  }
  return body as T;
}

export function fetchLearnerIdentity(token: string): Promise<LearnerIdentity> {
  return learnerRequest<LearnerIdentity>('/api/learner/me', token);
}

export interface PublishedLearnerFeedback { submissionId: string; task: PublishedHomeworkTask; body: string; feedback: LearnerFeedback; audio?: { durationMs: number; available: boolean; recoverable?: boolean } }
export async function fetchLearnerFeedback(token: string): Promise<PublishedLearnerFeedback[]> {
  return (await learnerRequest<{ feedback: PublishedLearnerFeedback[] }>('/api/learner/feedback', token)).feedback;
}

export async function uploadLearnerVoice(token: string, input: { sessionId: string; taskId: string; submissionId: string; assignmentRevision: number }, audio: Blob, signal: AbortSignal): Promise<{ submissionId: string; durationMs: number }> {
  const query = new URLSearchParams({ ...input, assignmentRevision: String(input.assignmentRevision) });
  const response = await fetch(`${baseUrl}/api/learner/voice?${query}`, {
    method: 'POST', credentials: 'omit', signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' }, body: audio,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(response.status, 'Could not send recording', body?.error);
  }
  return response.json();
}

export async function fetchLearnerSessions(token: string): Promise<LearnerSession[]> {
  const body = await learnerRequest<{ sessions: LearnerSession[] }>('/api/learner/sessions', token);
  return body.sessions ?? [];
}

export async function fetchLearnerPractice(token: string, itemId?: string): Promise<LearnerPracticeItem[]> {
  const body = await learnerRequest<{ items: LearnerPracticeItem[] }>(`/api/learner/practice${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`, token);
  return body.items ?? [];
}

export function gradeLearnerPractice(
  token: string,
  input: { itemId: string; grade: 'again' | 'good'; answer: unknown; assignmentRevision: number; attemptId: string },
): Promise<{ done?: true; item?: LearnerPracticeItem }> {
  return learnerRequest('/api/learner/practice', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function saveLearnerWriting(
  token: string,
  input: { sessionId: string; taskId: string; body: string; assignmentRevision: number; submissionId: string },
): Promise<{ ok: true; submissionId: string }> {
  return learnerRequest('/api/learner/writing', token, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
