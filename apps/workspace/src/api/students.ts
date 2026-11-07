import type { StudentReturned } from '@openroom/editor';
import type { StudentKind, WorkspaceExperience, PublishedHomeworkTask, LearnerFeedback } from '@openroom/schema';
import { request } from './client';

/* --------------------------------------------------------------- tutoring */

export interface StudentSummary {
  id: string;
  spaceId: string;
  kind: StudentKind;
  displayName: string;
  nextNote?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface StudentDetail extends StudentSummary {
  profile: Record<string, unknown>;
  nextNote?: string;
}


export async function listStudents(options: {
  trash?: boolean;
  kind?: string;
} = {}): Promise<StudentSummary[]> {
  const query = new URLSearchParams();
  if (options.trash) query.set('trash', '1');
  if (options.kind) query.set('kind', options.kind);
  const qs = query.toString();
  const body = await request<{ students: StudentSummary[] }>(
    `/api/tutoring/students${qs ? `?${qs}` : ''}`,
  );
  return body.students ?? [];
}

export async function getStudent(id: string): Promise<StudentDetail> {
  const body = await request<{ student: StudentDetail }>(
    `/api/tutoring/students/${encodeURIComponent(id)}`,
  );
  return body.student;
}

export async function createStudent(input: {
  displayName: string;
  kind?: StudentKind;
  profile?: Record<string, unknown>;
  sourceSpaceId?: string;
  experience?: WorkspaceExperience;
}): Promise<StudentDetail> {
  const body = await request<{ student: StudentDetail }>('/api/tutoring/students', {
    method: 'POST',
    mutating: true,
    body: JSON.stringify(input),
  });
  return body.student;
}

export async function updateStudent(
  id: string,
  input: { displayName: string; kind?: StudentKind; profile: Record<string, unknown> },
): Promise<StudentDetail> {
  const body = await request<{ student: StudentDetail }>(
    `/api/tutoring/students/${encodeURIComponent(id)}`,
    { method: 'PATCH', mutating: true, body: JSON.stringify(input) },
  );
  return body.student;
}

export function trashStudent(id: string): Promise<{ ok: true; recoverable: true }> {
  return request(`/api/tutoring/students/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    mutating: true,
  });
}

export function restoreStudent(id: string): Promise<{ ok: true }> {
  return request(`/api/tutoring/students/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    mutating: true,
  });
}


/* ------------------------------------------------- student access links */

/**
 * What the tutor can ever see about a link after minting: enough to recognise
 * and revoke it, never enough to reconstruct it. `tokenPrefix` is the first 12
 * characters only.
 */
export interface StudentLinkSummary {
  id: string;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  learnerId: string;
  displayName: string;
}

/** The mint response — the only moment `token` exists outside the student's device. */
export interface MintedStudentLink {
  learnerId: string;
  displayName: string;
  id: string;
  token: string;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface StudentLearner { id: string; displayName: string }
export async function listStudentLearners(studentId: string): Promise<StudentLearner[]> {
  const body = await request<{ learners: StudentLearner[] }>(`/api/tutoring/students/${encodeURIComponent(studentId)}/learners`);
  return body.learners;
}

export async function listStudentLinks(studentId: string): Promise<StudentLinkSummary[]> {
  const body = await request<{ links: StudentLinkSummary[] }>(
    `/api/tutoring/students/${encodeURIComponent(studentId)}/links`,
  );
  return body.links ?? [];
}

export function mintStudentLink(
  studentId: string,
  input: { expiresInDays?: number; learnerId?: string; displayName?: string } = {},
): Promise<MintedStudentLink> {
  return request<MintedStudentLink>(
    `/api/tutoring/students/${encodeURIComponent(studentId)}/links`,
    { method: 'POST', mutating: true, body: JSON.stringify(input) },
  );
}

export function revokeStudentLink(studentId: string, linkId: string): Promise<{ ok: true }> {
  return request(
    `/api/tutoring/students/${encodeURIComponent(studentId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE', mutating: true },
  );
}

export function getStudentReturned(studentId: string): Promise<StudentReturned> {
  return request(`/api/tutoring/students/${encodeURIComponent(studentId)}/returned`);
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
const workPath = (studentId: string) => `/api/tutoring/students/${encodeURIComponent(studentId)}/work`;
export async function listLearnerWork(studentId: string): Promise<LearnerWork[]> {
  return (await request<{ work: LearnerWork[] }>(workPath(studentId))).work;
}
export function getLearnerWork(studentId: string, submissionId: string): Promise<LearnerWorkDetail> {
  return request(`${workPath(studentId)}/${encodeURIComponent(submissionId)}`);
}
export function saveLearnerFeedback(studentId: string, submissionId: string, input: { feedback: LearnerFeedback; version: number; action: 'save' | 'publish' }): Promise<{ ok: true; version: number; published: LearnerFeedback | null }> {
  return request(`${workPath(studentId)}/${encodeURIComponent(submissionId)}/feedback`, { method: 'PUT', mutating: true, body: JSON.stringify(input) });
}
