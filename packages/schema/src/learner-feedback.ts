export interface LearnerCorrection { original: string; replacement: string; explanation: string }
export interface AudioComment { atMs: number; comment: string }
export interface LearnerFeedback { message: string; corrections: LearnerCorrection[]; audioComments?: AudioComment[] }

/** Shared validation for private drafts and deliberately published feedback. */
export function parseLearnerFeedback(value: unknown): LearnerFeedback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.message !== 'string' || row.message.length > 10_000 || !Array.isArray(row.corrections) || row.corrections.length > 30) return null;
  const corrections: LearnerCorrection[] = [];
  for (const item of row.corrections) {
    if (!item || typeof item !== 'object') return null;
    const correction = item as Record<string, unknown>;
    if (typeof correction.original !== 'string' || !correction.original.trim() || correction.original.length > 2_000 || typeof correction.replacement !== 'string' || correction.replacement.length > 2_000 || typeof correction.explanation !== 'string' || correction.explanation.length > 2_000) return null;
    corrections.push({ original: correction.original, replacement: correction.replacement, explanation: correction.explanation });
  }
  const audioComments: AudioComment[] = [];
  if (row.audioComments !== undefined) {
    if (!Array.isArray(row.audioComments) || row.audioComments.length > 30) return null;
    for (const item of row.audioComments) {
      if (!item || typeof item !== 'object') return null;
      const note = item as Record<string, unknown>;
      if (typeof note.atMs !== 'number' || !Number.isSafeInteger(note.atMs) || note.atMs < 0 || note.atMs > 300_000 || typeof note.comment !== 'string' || !note.comment.trim() || note.comment.length > 2_000) return null;
      audioComments.push({ atMs: note.atMs, comment: note.comment });
    }
  }
  return { message: row.message, corrections, ...(audioComments.length ? { audioComments } : {}) };
}
