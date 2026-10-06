/**
 * SessionDO — the single authoritative owner of one live session.
 *
 * Storage (SQLite-backed DO):
 *   session(id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT)   -- whole SessionState as JSON
 *   idempotency(key TEXT PRIMARY KEY, result TEXT, ts INTEGER)
 *   meta(k TEXT PRIMARY KEY, v TEXT)                          -- lastActivity / lastBroadcast / pendingBroadcastAt / lastResults / pendingResultsAt / joinSeq
 *
 * Persistence choice: `sql.exec` calls inside one method run on the same
 * storage backend and the DO's output gate holds the response until the writes
 * are durable, so the state write + idempotency write are issued sequentially
 * rather than through `transactionSync`. Neither can be observed by another
 * request in between (the DO is single-threaded and the gate blocks output),
 * which is the property we actually need.
 *
 * Broadcast fan-out is selective (sockets are tagged with the token-verified
 * role at accept time) and runs on two channels:
 *
 *   lifecycle — host-driven changes every client must see (open/close/reveal/
 *               next/freeze/theme/end). Audience: ALL sockets, coalesced at
 *               250 ms.
 *   results   — ballot-shaped changes (answer.submit, qna.vote, joins).
 *               Audience: host + stage only, coalesced at 1 s; participant
 *               sockets are included ONLY while the active interaction's
 *               results are visible to participants (live mode or revealed).
 *               Session Q&A (qna.ask / qna.upvote) rides this channel with a
 *               coalescing "include participants" flag: everyone sees the
 *               shared question list, so those ticks always reach participant
 *               sockets — without loosening the poll-ballot gating above.
 *
 * Without the split, every ballot notified every participant and each notified
 * participant re-fetched a snapshot — O(N²) HTTP requests per answering round.
 * Participants already hold the HTTP acknowledgement for their own ballot, so
 * a hidden-results ballot is information they never need pushed.
 *
 * An instance field mirrors `meta.lastBroadcast` / `meta.lastResults`. After a
 * mutation, broadcast immediately if that channel's last broadcast is older
 * than its interval, otherwise remember the revision and arm the alarm.
 *
 * Alarms are multiplexed: one alarm serves both pending broadcasts, hourly
 * housekeeping (idempotency pruning + 12 h idle auto-end), and the two retention
 * deadlines below. `closesAt` is an advisory window only — zero never closes
 * answering. `alarm()` always re-arms to the nearest remaining one.
 */

import {
  applyCommand,
  registerFacilitator,
  facilitatorCanCommand,
  type SessionFacilitator,
  createSession,
  ensureQna,
  generateHandle,
  purgeBallots,
  resultsVisible,
  sessionOf,
  type Command,
  type CommandEnvelope,
  type DomainError,
  type SessionState,
} from '@openroom/domain';
import {
  OPENROOM_RESOURCE_CONTENT_TYPES,
  OPENROOM_RESOURCE_MAX_BYTES,
  OPENROOM_RESOURCE_TOTAL_MAX_BYTES,
  outlineResourceIds,
  mapOutlineResourceSources,
  openRoomResourceBytesMatch as resourceBytesMatchType,
  type Outline,
} from '@openroom/schema';

import { exportAggregateCsv, exportBallotsCsv, exportJson, parseExportFormat } from './export.js';
import { absolutizeJoinUrl, type JoinOriginEnv } from './join-url.js';
import {
  hostWireSnapshot,
  participantWireSnapshot,
  stageWireSnapshot,
  type WireJson as Json,
} from '@openroom/domain';
import type { Role } from './tokens.js';
import { RESOURCE_ID_PATTERN, assetResponse } from './session-do/assets.js';
import { exportResponse } from './session-do/export-response.js';
import { recapCandidates, readRecapBody, selectedRecap } from './session-recap.js';
import { json } from './session-do/http.js';
import { snapshotResponse } from './session-do/snapshot-response.js';

const BROADCAST_INTERVAL_MS = 250;
const RESULTS_INTERVAL_MS = 1000;
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000; // 1h
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1h
const SESSION_IDLE_LIMIT_MS = 12 * 60 * 60 * 1000; // 12h
const RECOVERY_WINDOW_MS = 60 * 1000;
export const RECOVERY_FAILURE_LIMIT = 20;

/**
 * Retention schedule (PRD DATA-04). Both clocks start when the session reaches
 * `ended` — by host command or by the 12 h idle auto-end.
 *   PURGE_AFTER_MS  ballots and participant records are dropped; aggregates and
 *                   anonymized text survive and stay exportable as JSON.
 *   DELETE_AFTER_MS the whole Durable Object storage is wiped; the session then
 *                   404s exactly like a code that was never issued.
 */
export const PURGE_AFTER_MS = 30 * 60 * 1000; // 30min
export const DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const ASSET_CHUNK_BYTES = 1024 * 1024;

export interface CommandResult {
  status: number;
  body: { ok: true; revision: number } | { ok: false; error: DomainError };
}

function outlineWithSessionAssetUrls(outline: Outline, sessionCode: string): Outline {
  const replace = <T extends { url?: string; assetId?: string; resourceId?: string }>(source: T): T => {
    if (source.resourceId === undefined) return source;
    const { resourceId, ...rest } = source;
    return { ...rest, url: `/api/sessions/${encodeURIComponent(sessionCode)}/assets/${encodeURIComponent(resourceId)}` } as T;
  };
  return mapOutlineResourceSources(outline, replace);
}

/** Map a domain error onto the HTTP status contract (CONTRACTS §HTTP API). */
export function statusForError(error: DomainError): number {
  if (error.code === 'E_REVISION_CONFLICT') return 409;
  if (error.code === 'E_FORBIDDEN') return 403;
  return 422;
}

export class SessionDO implements DurableObject {
  readonly #ctx: DurableObjectState;
  readonly #sql: SqlStorage;
  readonly #joinEnv: JoinOriginEnv;
  #state: SessionState | null = null;
  #loaded = false;
  #lastBroadcast = 0;
  #lastResults = 0;
  /** next results flush must include participant sockets (session Q&A changed) */
  #pendingResultsToParticipants = false;
  #pendingResultsGroupIds = new Set<string>();

  constructor(ctx: DurableObjectState, env: JoinOriginEnv) {
    this.#ctx = ctx;
    this.#sql = ctx.storage.sql;
    this.#joinEnv = env;
    this.#ensureSchema();
    this.#ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * Test-only: drop in-memory caches the way a hibernation wake does, while
   * leaving hibernatable WebSockets and SQLite intact.
   *
   * `evictDurableObject` from `cloudflare:test` currently times out on this
   * class ("active references"), so local hibernation coverage uses this
   * helper for socket-preserving wake tests, plus `abortAllDurableObjects`
   * when a full constructor re-run is required.
   */
  simulateHibernationWakeForTest(): void {
    this.#state = null;
    this.#loaded = false;
    this.#pendingResultsGroupIds.clear();
    this.#lastBroadcast = 0;
    this.#lastResults = 0;
    this.#pendingResultsToParticipants = false;
  }

  /* ------------------------------------------------------------- storage */

  /**
   * Idempotent schema creation — also re-runs after a retention wipe.
   * One statement per `sql.exec` (clearer errors; avoids multi-statement quirks).
   */
  #ensureSchema(): void {
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL)',
    );
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, result TEXT NOT NULL, ts INTEGER NOT NULL)',
    );
    this.#sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS session_assets (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, chunk_count INTEGER NOT NULL)',
    );
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS session_asset_chunks (asset_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(asset_id, chunk_index))',
    );
  }

  /** Lazily reload state from SQL — the first access after a hibernation wake. */
  #load(): SessionState | null {
    if (this.#loaded) return this.#state;
    const rows = this.#sql.exec<{ state: string }>('SELECT state FROM session WHERE id = 1').toArray();
    const row = rows[0];
    // ensureQna patches the session-Q&A region into session states stored before
    // the field existed (back-compat; no storage migration needed).
    this.#state = row === undefined ? null : ensureQna(JSON.parse(row.state) as SessionState);
    this.#lastBroadcast = this.#metaNumber('lastBroadcast', 0);
    this.#lastResults = this.#metaNumber('lastResults', 0);
    this.#pendingResultsToParticipants = this.#metaNumber('pendingResultsQna', 0) > 0;
    const pendingGroups = this.#sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', 'pendingResultsGroups').toArray()[0]?.v;
    this.#pendingResultsGroupIds = new Set<string>(pendingGroups ? JSON.parse(pendingGroups) : []);
    this.#loaded = true;
    return this.#state;
  }

  #persist(state: SessionState): void {
    this.#sql.exec(
      'INSERT INTO session (id, state) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',
      JSON.stringify(state),
    );
    this.#state = state;
    this.#loaded = true;
  }

  #metaNumber(key: string, fallback: number): number {
    const rows = this.#sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', key).toArray();
    const row = rows[0];
    if (row === undefined) return fallback;
    const parsed = Number(row.v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  #setMeta(key: string, value: number): void {
    this.#sql.exec(
      'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      String(value),
    );
  }

  #setMetaText(key: string, value: string): void {
    this.#sql.exec(
      'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      value,
    );
  }

  #resourceIds(): string[] {
    const row = this.#sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', 'resourceIds').toArray()[0];
    if (row === undefined) return [];
    try {
      const parsed = JSON.parse(row.v) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  #recoveryAllowed(now: number): boolean {
    const windowStart = this.#metaNumber('recoveryWindowStart', 0);
    if (windowStart === 0 || now - windowStart >= RECOVERY_WINDOW_MS) return true;
    return this.#metaNumber('recoveryFailures', 0) < RECOVERY_FAILURE_LIMIT;
  }

  #recordRecoveryFailure(now: number): void {
    const windowStart = this.#metaNumber('recoveryWindowStart', 0);
    if (windowStart === 0 || now - windowStart >= RECOVERY_WINDOW_MS) {
      this.#setMeta('recoveryWindowStart', now);
      this.#setMeta('recoveryFailures', 1);
      return;
    }
    this.#setMeta('recoveryFailures', this.#metaNumber('recoveryFailures', 0) + 1);
  }

  /* ---------------------------------------------------------- broadcasts */

  #send(sockets: Iterable<WebSocket>, revision: number): void {
    const message = JSON.stringify({ v: 1, type: 'session.changed', revision });
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        // a dead socket is dropped by the runtime; nothing to do here
      }
    }
  }

  /** Lifecycle broadcast to every socket. Supersedes any pending results tick. */
  #broadcastNow(revision: number, now: number): void {
    this.#send(this.#ctx.getWebSockets(), revision);
    this.#lastBroadcast = now;
    this.#setMeta('lastBroadcast', now);
    this.#setMeta('pendingBroadcastAt', 0);
    // Everyone just refetched, so the results audience is covered too.
    this.#lastResults = now;
    this.#pendingResultsToParticipants = false;
    this.#setMeta('lastResults', now);
    this.#setMeta('pendingResultsAt', 0);
    this.#setMeta('pendingResultsQna', 0);
    this.#pendingResultsGroupIds.clear();
    this.#setMetaText('pendingResultsGroups', '[]');
  }

  /**
   * The results audience: host + stage always; participant sockets only while
   * the active interaction's results are visible to them (live mode, or after
   * reveal). Computed at send time, so a mid-burst reveal flips participants in.
   */
  #resultsSockets(includeParticipants: boolean): WebSocket[] {
    const sockets = [...this.#ctx.getWebSockets('host'), ...this.#ctx.getWebSockets('stage')];
    const state = this.#load();
    const activeId = state?.activeInteractionId ?? null;
    if (
      includeParticipants ||
      (state !== null && activeId !== null && resultsVisible(state, activeId))
    ) {
      sockets.push(...this.#ctx.getWebSockets('participant'));
    } else if (state) {
      for (const id of this.#pendingResultsGroupIds) {
        for (const memberId of state.groups?.[id]?.memberIds ?? []) {
          sockets.push(...this.#ctx.getWebSockets(`participant:${memberId}`));
        }
      }
    }
    return [...new Set(sockets)];
  }

  #resultsBroadcastNow(revision: number, now: number): void {
    this.#send(this.#resultsSockets(this.#pendingResultsToParticipants), revision);
    this.#lastResults = now;
    this.#pendingResultsToParticipants = false;
    this.#setMeta('lastResults', now);
    this.#setMeta('pendingResultsAt', 0);
    this.#setMeta('pendingResultsQna', 0);
    this.#pendingResultsGroupIds.clear();
    this.#setMetaText('pendingResultsGroups', '[]');
  }

  async #notify(revision: number, now: number): Promise<void> {
    if (now - this.#lastBroadcast >= BROADCAST_INTERVAL_MS) {
      this.#broadcastNow(revision, now);
      await this.#rearmAlarm(now);
      return;
    }
    this.#setMeta('pendingBroadcastAt', this.#lastBroadcast + BROADCAST_INTERVAL_MS);
    await this.#rearmAlarm(now);
  }

  async #notifyResults(revision: number, now: number, toParticipants = false, groupId?: string): Promise<void> {
    if (groupId && !this.#pendingResultsGroupIds.has(groupId)) {
      this.#pendingResultsGroupIds.add(groupId);
      this.#setMetaText('pendingResultsGroups', JSON.stringify([...this.#pendingResultsGroupIds]));
    }
    if (toParticipants && !this.#pendingResultsToParticipants) {
      // OR-accumulated while coalescing; mirrored in meta so a hibernation
      // between the mutation and the flush cannot drop the participant fan-out.
      this.#pendingResultsToParticipants = true;
      this.#setMeta('pendingResultsQna', 1);
    }
    if (now - this.#lastResults >= RESULTS_INTERVAL_MS) {
      this.#resultsBroadcastNow(revision, now);
      await this.#rearmAlarm(now);
      return;
    }
    this.#setMeta('pendingResultsAt', this.#lastResults + RESULTS_INTERVAL_MS);
    await this.#rearmAlarm(now);
  }

  /**
   * Nearest of: the pending broadcast, the next housekeeping sweep, an armed
   * interaction countdown, and the two retention deadlines. A deadline already
   * in the past is kept as-is — the runtime fires such an alarm immediately,
   * which is exactly what we want.
   */
  #nextAlarmAt(now: number): number {
    const candidates = [now + HOUSEKEEPING_INTERVAL_MS];
    const pendingAt = this.#metaNumber('pendingBroadcastAt', 0);
    if (pendingAt > 0) candidates.push(pendingAt);
    const pendingResultsAt = this.#metaNumber('pendingResultsAt', 0);
    if (pendingResultsAt > 0) candidates.push(pendingResultsAt);
    const endedAt = this.#metaNumber('endedAt', 0);
    if (endedAt > 0) {
      if (this.#load()?.purgedAt === undefined) candidates.push(endedAt + PURGE_AFTER_MS);
      candidates.push(endedAt + DELETE_AFTER_MS);
    }
    return Math.min(...candidates);
  }

  /** Arm the single multiplexed alarm, never pushing an earlier one later. */
  async #rearmAlarm(now: number): Promise<void> {
    const target = this.#nextAlarmAt(now);
    const current = await this.#ctx.storage.getAlarm();
    if (current === null || current > target) {
      await this.#ctx.storage.setAlarm(target);
    }
  }

  /** Start the retention clocks (PRD DATA-04) the moment a session ends. */
  #markEnded(state: SessionState, now: number): void {
    this.#setMeta('endedAt', state.endedAt ?? now);
  }

  /**
   * Full deletion: drop every socket, then wipe storage. `deleteAll()` clears
   * the SQL tables and the pending alarm together, so afterwards the object is
   * indistinguishable from one that was never initialized — join and state take
   * the same 404 path. The in-memory copy is dropped too; without that a warm
   * instance would keep answering from a session that no longer exists.
   */
  async #wipe(): Promise<void> {
    for (const socket of this.#ctx.getWebSockets()) {
      try {
        socket.close(1001, 'session-deleted');
      } catch {
        // already gone
      }
    }
    await this.#ctx.storage.deleteAll();
    this.#ensureSchema();
    this.#state = null;
    this.#loaded = true;
    this.#pendingResultsGroupIds.clear();
    this.#lastBroadcast = 0;
    this.#lastResults = 0;
    this.#pendingResultsToParticipants = false;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let state = this.#load();

    const pendingAt = this.#metaNumber('pendingBroadcastAt', 0);
    if (pendingAt > 0 && pendingAt <= now && state !== null) {
      // This flush supersedes pending results too: announce the latest stored
      // revision, including ballots accepted since the lifecycle tick was queued.
      this.#broadcastNow(state.revision, now);
    }
    // A lifecycle flush above already cleared this; check again rather than
    // caching the value from before the broadcast.
    const pendingResultsAt = this.#metaNumber('pendingResultsAt', 0);
    if (pendingResultsAt > 0 && pendingResultsAt <= now && state !== null) {
      this.#resultsBroadcastNow(state.revision, now);
    }

    // housekeeping: prune stale idempotency rows
    this.#sql.exec('DELETE FROM idempotency WHERE ts < ?', now - IDEMPOTENCY_TTL_MS);

    // housekeeping: auto-end sessions idle for 12h
    state = this.#load();
    if (state !== null && state.status !== 'ended') {
      const lastActivity = this.#metaNumber('lastActivity', now);
      if (now - lastActivity > SESSION_IDLE_LIMIT_MS) {
        const result = applyCommand(
          state,
          {
            idempotencyKey: `expiry-${now}`,
            actor: { role: 'host', facilitatorId: state.facilitation.presenterId },
            command: { command: 'session.end' },
          },
          now,
        );
        if (result.ok) {
          state = result.state;
          this.#persist(state);
          this.#markEnded(state, now);
          this.#broadcastNow(result.revision, now);
        }
      }
    }

    // retention (PRD DATA-04): purge ballots, then delete the session outright
    const endedAt = this.#metaNumber('endedAt', 0);
    if (state !== null && endedAt > 0) {
      if (now - endedAt >= DELETE_AFTER_MS) {
        await this.#wipe();
        return; // nothing left to schedule; deleteAll took the alarm with it
      }
      if (now - endedAt >= PURGE_AFTER_MS) {
        const purged = purgeBallots(state, now);
        if (purged !== state) {
          state = purged;
          this.#persist(state);
          this.#broadcastNow(state.revision, now);
        }
      }
    }

    await this.#ctx.storage.setAlarm(this.#nextAlarmAt(now));
  }

  /* --------------------------------------------------------------- fetch */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const assetMatch = /^\/__assets\/([^/]+)$/.exec(url.pathname);
    if (assetMatch !== null) {
      const resourceId = decodeURIComponent(assetMatch[1] as string);
      if (request.method === 'PUT') return this.#putAsset(request, resourceId);
      if (request.method === 'GET' || request.method === 'HEAD') return this.#getAsset(request, resourceId);
      return json({ error: 'method-not-allowed' }, 405);
    }
    switch (url.pathname) {
      case '/__init':
        return this.#init(request);
      case '/__facilitator':
        return this.#facilitator(request);
      case '/__join':
        return this.#join(request);
      case '/__state':
        return this.#snapshot(url);
      case '/__command':
        return this.#command(request);
      case '/__export':
        return this.#export(url);
      case '/__recap': {
        const body = request.method === 'POST' ? await readRecapBody(request) : null;
        const state = this.#load();
        if (!state) return json({ error: 'session-not-found' }, 404);
        if (state.purgedAt !== undefined) return json({ error: 'recap-source-purged' }, 410);
        if (request.method === 'GET') return json(recapCandidates(state));
        if (request.method === 'POST') return selectedRecap(state, body);
        return json({ error: 'method-not-allowed' }, 405);
      }
      case '/__ws':
        return this.#websocket(request, url);
      default:
        return json({ error: 'not-found' }, 404);
    }
  }

  /* ---------------------------------------------------------------- init */

  async #init(request: Request): Promise<Response> {
    /*
     * `sessionCode` is the session's whole identity: the DO is named by it and
     * it is the code participants type in. The state carries it once, as
     * `code` — there is no second internal id.
     */
    const body = (await request.json()) as {
      outline: Outline;
      sessionCode: string;
      outlineVersion?: number;
      facilitator?: { id: string; name: string };
    };
    if (this.#load() !== null) return json({ error: 'already-initialized' }, 409);
    const now = Date.now();
    const resourceIds = outlineResourceIds(body.outline);
    if (resourceIds.length > 0) this.#setMetaText('resourceIds', JSON.stringify(resourceIds));
    const sessionOutline = outlineWithSessionAssetUrls(body.outline, body.sessionCode);
    const state = createSession(sessionOutline, body.sessionCode, now, {
      outlineVersion: body.outlineVersion ?? 1,
      ...(body.facilitator ? { facilitator: body.facilitator } : {}),
    });
    this.#persist(state);
    this.#setMeta('lastActivity', now);
    await this.#rearmAlarm(now);
    return json({ ok: true, sessionCode: state.code, code: state.code, revision: state.revision });
  }

  async #facilitator(request: Request): Promise<Response> {
    const facilitator = await request.json() as SessionFacilitator;
    const state = this.#load();
    if (!state) return json({ error: 'session-not-found' }, 404);
    const result = registerFacilitator(state, facilitator);
    if (!result.ok) return json({ ok: false, error: result.error }, statusForError(result.error));
    if (result.state !== state) {
      this.#persist(result.state);
      await this.#notify(result.revision, Date.now());
    }
    return json({ ok: true, facilitation: result.state.facilitation });
  }

  /* ---------------------------------------------------------------- join */

  /**
   * The domain has no `participant.join` command (participants are only
   * materialized lazily by `answer.submit` / `qna.vote` via `ensureParticipant`).
   * Registration therefore happens here: we insert the participant into
   * `state.participants` and bump `revision` by hand so the stage's joined
   * count moves and every client refetches. This is the ONE place outside
   * `applyCommand` that mutates session state — documented deviation.
   */
  async #join(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as
      | { recoveryHandle?: unknown; identity?: unknown }
      | null;
    // Body I/O may interleave with other requests. Read current state only after it finishes.
    const state = this.#load();
    if (state === null || state.status === 'ended') {
      return json({ error: 'session-not-found' }, 404);
    }
    const now = Date.now();
    const identityMode = sessionOf(state).defaults.identityMode;

    /*
     * Identified mode. The DO knows nothing about contexts or access links —
     * the Worker has already verified the `orlnk_` capability AND proved it
     * belongs to this session's originating context, and passes only the resulting
     * display name. The DO's job is the invariant that identified sessions are
     * *only* enterable that way: no link, no join.
     */
    const identityBody =
      typeof body?.identity === 'object' && body.identity !== null
        ? (body.identity as { displayName?: unknown; seatKey?: unknown })
        : undefined;
    const supplied = identityBody?.displayName;
    const seatKeyRaw = identityBody?.seatKey;
    const identityName =
      typeof supplied === 'string' ? supplied.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
    const seatKey =
      typeof seatKeyRaw === 'string' ? seatKeyRaw.trim().slice(0, 64) : '';
    if (identityMode === 'identified' || identityMode === 'roster') {
      if (identityName === '') {
        return json(
          {
            error: identityMode === 'roster' ? 'roster-invite-required' : 'context-link-required',
            message:
              identityMode === 'roster'
                ? 'This session is only open to people on the roster.'
                : 'This session is only open to people with an access link.',
          },
          403,
        );
      }
      /*
       * Identified sessions are enterable only once the tutor has actually started
       * the session. The tutor pressing start IS the gate: a leaked link cannot
       * be used against an unattended lobby, so possession of the link buys
       * nothing outside a window the tutor is present for and can see.
       *
       * `lobby` is the status this rules out; `ended` already 404s above, and
       * `frozen` is a separate boolean on a session that stays `live`, so a frozen
       * session still admits the re-entry below — a student whose page reloads
       * during a panic freeze must not be locked out of their own session.
       *
       * Anonymous and pseudonymous sessions are untouched: they can still be
       * joined from the lobby, which is how a class files in before the host
       * starts.
       */
      if (identityMode === 'identified' && state.status !== 'live') {
        return json(
          {
            error: 'session-not-started',
            message: 'The tutor has not started the session.',
          },
          409,
        );
      }
    } else if (supplied !== undefined) {
      return json(
        {
          error: 'identified-join-unavailable',
          message: 'This session does not use access links.',
        },
        409,
      );
    }

    if (body?.recoveryHandle !== undefined) {
      if (identityMode !== 'pseudonymous') {
        return json(
          { error: 'handle-recovery-unavailable', message: 'This session does not use handles.' },
          409,
        );
      }
      if (typeof body.recoveryHandle !== 'string') {
        return json({ error: 'invalid-handle', message: 'Enter your session handle.' }, 400);
      }
      const recoveryHandle = body.recoveryHandle.trim().replace(/\s+/g, ' ');
      if (recoveryHandle.length < 3 || recoveryHandle.length > 64) {
        return json({ error: 'invalid-handle', message: 'Enter your complete session handle.' }, 400);
      }
      if (!this.#recoveryAllowed(now)) {
        return json(
          {
            error: 'recovery-rate-limited',
            message: 'Too many recovery attempts. Wait a minute and try again.',
          },
          429,
        );
      }

      const recoveryKey = recoveryHandle.toLocaleLowerCase('en');
      const recovered = Object.entries(state.participants).find(
        ([, record]) => record.handle?.toLocaleLowerCase('en') === recoveryKey,
      );
      if (recovered === undefined) {
        this.#recordRecoveryFailure(now);
        return json(
          { error: 'handle-not-found', message: 'That handle is not in this session.' },
          404,
        );
      }

      const [participantId, record] = recovered;
      this.#setMeta('lastActivity', now);
      return json({
        sessionCode: state.code,
        participantId,
        revision: state.revision,
        identityMode,
        handle: record.handle,
      });
    }

    if (identityMode === 'identified' || identityMode === 'roster') {
      // The invite or link *is* the recovery credential: re-entering with the
      // same seat key (never the raw token) must land on the same participant.
      const existing = Object.entries(state.participants).find(
        ([, record]) =>
          (seatKey !== '' && record.seatKey === seatKey) ||
          (record.seatKey === undefined && record.handle === identityName),
      );
      if (existing !== undefined) {
        this.#setMeta('lastActivity', now);
        return json({
          sessionCode: state.code,
          participantId: existing[0],
          revision: state.revision,
          identityMode,
          handle: identityName,
        });
      }
    }

    const participantId = crypto.randomUUID();
    /*
     * Pair-work lanes come from a monotonic join counter in `meta`, never from
     * the size of the participant map: the map shrinks (retention purge), so
     * parity over it would hand two consecutive joiners the same lane. The
     * counter only advances for a genuinely new participant — the rejoin paths
     * above return before this point, so a returning learner keeps the lane
     * their record already carries.
     *
     * Assign stable lanes before a paired activity appears, so the teacher can
     * insert one during the lesson. Only cards marked with a lane are filtered.
     */
    const paired = state.outline !== undefined;
    const joinSeq = this.#metaNumber('joinSeq', 0);
    const lane = paired ? ((joinSeq % 2) as 0 | 1) : undefined;
    if (paired) this.#setMeta('joinSeq', joinSeq + 1);
    let handle: string | undefined;
    if (identityMode === 'identified' || identityMode === 'roster') {
      handle = identityName;
    } else if (identityMode === 'pseudonymous') {
      const taken = new Set<string>();
      for (const record of Object.values(state.participants)) {
        if (record.handle !== undefined) taken.add(record.handle);
      }
      handle = generateHandle(taken);
    }
    const next: SessionState = {
      ...state,
      revision: state.revision + 1,
      participants: {
        ...state.participants,
        [participantId]: {
          joinedAt: now,
          ...(handle === undefined ? {} : { handle }),
          ...((identityMode === 'identified' || identityMode === 'roster') && seatKey !== ''
            ? { seatKey }
            : {}),
          ...(lane === undefined ? {} : { lane }),
        },
      },
    };
    this.#persist(next);
    this.#setMeta('lastActivity', now);
    // A join only moves the participant counter — monitor-facing data.
    await this.#notifyResults(next.revision, now);
    return json({
      sessionCode: next.code,
      participantId,
      revision: next.revision,
      identityMode,
      ...(handle === undefined ? {} : { handle }),
    });
  }

  /* ------------------------------------------------------------ snapshot */

  #snapshot(url: URL): Response {
    const state = this.#load();
    if (state === null) return json({ error: 'session-not-found' }, 404);
    return snapshotResponse(
      { state, joinEnv: this.#joinEnv },
      url,
    );
  }

  /* ------------------------------------------------------------- command */

  async #command(request: Request): Promise<Response> {
    const envelope = (await request.json()) as CommandEnvelope;
    // Keep the current-state read, authorization, domain mutation and SQL writes synchronous.
    // An await between that read and the write can discard another acknowledged mutation.
    const state = this.#load();
    if (state === null) return json({ error: 'session-not-found' }, 404);
    if (envelope.actor.role === 'host' && !facilitatorCanCommand(state, envelope.actor.facilitatorId ?? '', envelope.command)) {
      return json({ ok: false, error: { code: 'E_FORBIDDEN', message: 'Only the active presenter can change the presentation.' } }, 403);
    }
    const key = typeof envelope.idempotencyKey === 'string' && envelope.idempotencyKey !== ''
      ? JSON.stringify([envelope.actor.role, envelope.actor.facilitatorId ?? envelope.actor.participantId ?? '', envelope.idempotencyKey])
      : '';

    if (typeof key === 'string' && key !== '') {
      const rows = this.#sql
        .exec<{ result: string }>('SELECT result FROM idempotency WHERE key = ?', key)
        .toArray();
      const cached = rows[0];
      if (cached !== undefined) {
        // Replay the stored acknowledgement verbatim.
        const stored = JSON.parse(cached.result) as CommandResult;
        return json(stored.body, stored.status);
      }
    }

    const now = Date.now();
    if (envelope.command.command === 'session.start') {
      const present = new Set(
        this.#sql.exec<{ id: string }>('SELECT id FROM session_assets').toArray().map((row) => row.id),
      );
      const missing = this.#resourceIds().filter((id) => !present.has(id));
      if (missing.length > 0) {
        return json({
          ok: false,
          error: { code: 'E_SESSION_ASSETS_MISSING', message: 'Upload embedded session resources before starting.' },
          resourceIds: missing,
        }, 409);
      }
    }
    const result = applyCommand(state, envelope, now);

    if (!result.ok) {
      // Errors are NOT recorded: a retry after a transient conflict must be
      // able to succeed with the same idempotency key.
      return json({ ok: false, error: result.error }, statusForError(result.error));
    }

    const payload: CommandResult = { status: 200, body: { ok: true, revision: result.revision } };
    this.#persist(result.state);
    if (typeof key === 'string' && key !== '') {
      this.#sql.exec(
        'INSERT INTO idempotency (key, result, ts) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
        key,
        JSON.stringify(payload),
        now,
      );
    }
    this.#setMeta('lastActivity', now);
    if (state.status !== 'ended' && result.state.status === 'ended') {
      this.#markEnded(result.state, now);
    }

    if (result.effects.some((effect) => effect.type === 'notify')) {
      // Individual ballots use the narrow results channel: the submitter
      // already has its HTTP ack. Group ballots also notify that group,
      // whose shared answer is visible before the aggregate is revealed. Session Q&A is different: the question list is
      // a shared surface every participant renders, so qna.ask/qna.upvote ride
      // the same channel but flag the flush to include participant sockets.
      // Host commands change what everyone renders.
      if (PARTICIPANT_COMMANDS.has(envelope.command.command)) {
        const isSessionQna =
          envelope.command.command === 'qna.ask' || envelope.command.command === 'qna.upvote';
        const submittedId = envelope.command.command === 'answer.submit' ? envelope.command.interactionId : null;
        const isGroupAnswer = submittedId !== null &&
          result.state.outline.content.interactions.find((item) => item.id === submittedId)?.responseMode === 'group';
        const groupId = isGroupAnswer && envelope.command.command === 'answer.submit' ? envelope.command.groupId : undefined;
        await this.#notifyResults(result.revision, now, isSessionQna, groupId);
      } else {
        await this.#notify(result.revision, now);
      }
    }
    return json(payload.body, payload.status);
  }

  async #putAsset(request: Request, resourceId: string): Promise<Response> {
    const state = this.#load();
    if (state === null) return json({ error: 'session-not-found' }, 404);
    if (state.status !== 'lobby') return json({ error: 'session-already-started' }, 409);
    if (!RESOURCE_ID_PATTERN.test(resourceId) || !this.#resourceIds().includes(resourceId)) {
      return json({ error: 'resource-not-in-session' }, 404);
    }
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!(OPENROOM_RESOURCE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      return json({ error: 'unsupported-content-type' }, 415);
    }
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > OPENROOM_RESOURCE_MAX_BYTES) return json({ error: 'asset-too-large' }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > OPENROOM_RESOURCE_MAX_BYTES) {
      return json({ error: 'asset-too-large' }, 413);
    }
    if (!resourceBytesMatchType(bytes, contentType)) return json({ error: 'asset-signature-mismatch' }, 422);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (request.headers.get('x-openroom-sha256') !== hash) return json({ error: 'asset-hash-mismatch' }, 422);
    // Start/end may have completed while the upload or digest was pending.
    const current = this.#load();
    if (current === null) return json({ error: 'session-not-found' }, 404);
    if (current.status !== 'lobby') return json({ error: 'session-already-started' }, 409);
    if (!this.#resourceIds().includes(resourceId)) return json({ error: 'resource-not-in-session' }, 404);
    const otherSize = this.#sql.exec<{ total: number }>(
      'SELECT COALESCE(SUM(size), 0) AS total FROM session_assets WHERE id != ?',
      resourceId,
    ).toArray()[0]?.total ?? 0;
    if (otherSize + bytes.byteLength > OPENROOM_RESOURCE_TOTAL_MAX_BYTES) {
      return json({ error: 'session-assets-too-large' }, 413);
    }
    const existing = this.#sql.exec<{ sha256: string }>(
      'SELECT sha256 FROM session_assets WHERE id = ?',
      resourceId,
    ).toArray()[0];
    if (existing?.sha256 === hash) return json({ ok: true, resourceId, unchanged: true });
    this.#sql.exec('DELETE FROM session_asset_chunks WHERE asset_id = ?', resourceId);
    this.#sql.exec('DELETE FROM session_assets WHERE id = ?', resourceId);
    const chunkCount = Math.ceil(bytes.byteLength / ASSET_CHUNK_BYTES);
    this.#sql.exec(
      'INSERT INTO session_assets (id, content_type, size, sha256, chunk_count) VALUES (?, ?, ?, ?, ?)',
      resourceId,
      contentType,
      bytes.byteLength,
      hash,
      chunkCount,
    );
    for (let index = 0; index < chunkCount; index += 1) {
      this.#sql.exec(
        'INSERT INTO session_asset_chunks (asset_id, chunk_index, bytes) VALUES (?, ?, ?)',
        resourceId,
        index,
        bytes.slice(index * ASSET_CHUNK_BYTES, (index + 1) * ASSET_CHUNK_BYTES),
      );
    }
    return json({ ok: true, resourceId }, 201);
  }

  #getAsset(request: Request, resourceId: string): Response {
    return assetResponse(this.#sql, request, resourceId);
  }

  /* -------------------------------------------------------------- export */

  #export(url: URL): Response {
    const state = this.#load();
    if (state === null) return json({ error: 'session-not-found' }, 404);
    return exportResponse(state, url);
  }

  /* ----------------------------------------------------------- websocket */

  #websocket(request: Request, url: URL): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected-websocket' }, 426);
    }
    if (this.#load() === null) return json({ error: 'session-not-found' }, 404);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const role = url.searchParams.get('role') ?? 'participant';
    // The Worker forwards this id only from the verified session capability.
    const participantId = role === 'participant' ? url.searchParams.get('participantId') : null;
    this.#ctx.acceptWebSocket(server, participantId ? [role, `participant:${participantId}`] : [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Clients send nothing but pings, which setWebSocketAutoResponse handles
    // without waking the object. Anything else is ignored.
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      // 1005 means the peer sent no status; neither it nor 1006 is sendable.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  webSocketError(): void {
    // nothing to clean up: hibernation sockets are tracked by the runtime
  }
}

/** Commands a given role is allowed to send (defence in depth; domain re-checks). */
export const PARTICIPANT_COMMANDS: ReadonlySet<Command['command']> = new Set([
  'answer.submit',
  'qna.vote',
  'qna.ask',
  'qna.upvote',
]);
