/**
 * What the session menu says when the individual-responses file cannot be
 * downloaded, and the toast for the same refusal from the server. The server
 * decides availability (`exportAvailability`, CONTRACTS §Export split) and the
 * host snapshot carries it; these are its sentences.
 */
import type { SessionExports } from '@openroom/sdk';

export type AnswersExport = SessionExports['answers'];

export const RESPONSES_NEED_PLAN = 'Downloading individual responses needs Named response exports.';
export const RESPONSES_DELETED = 'Individual responses were deleted 30 minutes after the session ended.';

const EXPORT_REFUSALS: Record<string, string> = {
  'raw-export-required': RESPONSES_NEED_PLAN,
  'answers-deleted': RESPONSES_DELETED,
};

/**
 * The toast for a failed download. The workspace client keeps the server code
 * on `code`; the Desktop client passes it through as the message.
 */
export function exportFailureLine(err: unknown): string {
  if (!(err instanceof Error)) return 'Export failed';
  const code = (err as { code?: unknown }).code;
  return (typeof code === 'string' ? EXPORT_REFUSALS[code] : undefined) ?? EXPORT_REFUSALS[err.message] ?? err.message;
}
