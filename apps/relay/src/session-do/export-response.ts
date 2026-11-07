import { sessionOf, type SessionState } from '@openroom/domain';

import { exportAggregateCsv, exportBallotsCsv, exportJson, parseExportFormat } from '../export.js';
import { json } from './http.js';

/**
 * Named ballot export. Pure over the loaded state.
 *
 * The Worker has already decided allowBallots from entitlements; guest-list
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
  // Per-ballot file.
  const allowBallots = url.searchParams.get('allowBallots') === '1';
  const guestList = sessionOf(state).defaults.identityMode === 'guest-list';
  if (!allowBallots && !guestList) {
    return json({ ok: false, error: 'raw-export-required' }, 403);
  }
  if (state.purgedAt !== undefined) {
    return json({ ok: false, error: 'ballots-purged' }, 410);
  }
  return new Response(exportBallotsCsv(state), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="openroom-${state.code}-${stamp}-ballots.csv"`,
    },
  });
}
