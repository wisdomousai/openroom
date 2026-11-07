import { sessionOf, type SessionState } from '@openroom/domain';

import { exportAggregateCsv, exportAnswersCsv, exportJson, parseExportFormat } from '../export.js';
import { json } from './http.js';

/**
 * Named answer export. Pure over the loaded state.
 *
 * The Worker has already decided allowAnswers from entitlements; guest-list
 * sessions are allowed here even without that flag.
 */
export function exportResponse(state: SessionState, url: URL): Response {
  const format = parseExportFormat(url.searchParams.get('format'));
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
  const allowAnswers = url.searchParams.get('allowAnswers') === '1';
  const guestList = sessionOf(state).defaults.identityMode === 'guest-list';
  if (!allowAnswers && !guestList) {
    return json({ ok: false, error: 'raw-export-required' }, 403);
  }
  if (state.answersDeletedAt !== undefined) {
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
