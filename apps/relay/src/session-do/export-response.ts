import { sessionOf, type SessionState } from '@openroom/domain';

import { exportAggregateCsv, exportAnswersCsv, exportJson, parseExportFormat } from '../export.js';
import { json } from './http.js';

/**
 * Whether the individual-responses file can be downloaded:
 * - `available`: it downloads now;
 * - `needs-plan`: the owner lacks Named response exports and the session is
 *   not a guest-list session (`403 raw-export-required`);
 * - `deleted`: individual responses were deleted 30 minutes after the end
 *   (`410 answers-deleted`). The Worker still serves a saved archive that
 *   holds them, and reports `available` for it on host state reads.
 */
export type AnswersExportAvailability = 'available' | 'needs-plan' | 'deleted';

/** Which exports this session offers. JSON and counts CSV stay until the session is wiped. */
export interface ExportAvailability {
  json: 'available';
  csv: 'available';
  answers: AnswersExportAvailability;
}

/**
 * The one definition of export availability: the export response below and
 * the host snapshot both read it. `allowAnswers` is the Worker's entitlement
 * answer (the owner's Named response exports); guest-list sessions export
 * answers without it.
 */
export function exportAvailability(state: SessionState, allowAnswers: boolean): ExportAvailability {
  const guestList = sessionOf(state).defaults.identityMode === 'guest-list';
  const answers: AnswersExportAvailability =
    !allowAnswers && !guestList ? 'needs-plan' : state.answersDeletedAt !== undefined ? 'deleted' : 'available';
  return { json: 'available', csv: 'available', answers };
}

/** Header on a host state read whose answers export reports `deleted`, so the Worker can check its archive. */
export const ANSWERS_DELETED_HEADER = 'x-openroom-answers-deleted';

/**
 * Named answer export. Pure over the loaded state.
 *
 * The Worker has already decided allowAnswers from entitlements; guest-list
 * sessions are allowed here even without that flag.
 */
export function exportResponse(state: SessionState, url: URL): Response {
  const format = parseExportFormat(url.searchParams.get('format'));
  if (format === null) return json({ error: 'invalid-format' }, 400);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    return json(exportJson(state), 200, {
      'content-disposition': `attachment; filename="openroom-${state.code}-${stamp}.json"`,
    });
  }
  if (format === 'csv') {
    return new Response(exportAggregateCsv(state), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="openroom-${state.code}-${stamp}-counts.csv"`,
      },
    });
  }
  // Per-answer file.
  const { answers } = exportAvailability(state, url.searchParams.get('allowAnswers') === '1');
  if (answers === 'needs-plan') {
    return json({ ok: false, error: 'raw-export-required' }, 403);
  }
  if (answers === 'deleted') {
    return json({ ok: false, error: 'answers-deleted' }, 410);
  }
  return new Response(exportAnswersCsv(state), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="openroom-${state.code}-${stamp}-answers.csv"`,
    },
  });
}
