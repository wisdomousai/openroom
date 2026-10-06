import type {
  Command,
  ConnectionStatus,
  JoinResult,
  Role,
  SessionChangedMessage,
  Snapshot,
  SubmitResult,
} from './types.js';

/* ------------------------------------------------------------ injection */

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    /**
     * JSON bodies are strings. Raw bytes are here for the media plane, whose
     * upload route takes the file itself as the body rather than a multipart
     * envelope (see `decks.ts` / `apps/worker/src/assets.ts`).
     */
    body?: string | Uint8Array | ArrayBuffer;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send?(data: string): void;
  close(): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface SessionClientOptions<S extends Snapshot = Snapshot> {
  /** Origin of the API, e.g. `https://openroom.example`. Empty = same origin. */
  baseUrl?: string;
  sessionCode: string;
  token: string;
  role: Role;
  onChange?: (snapshot: S) => void;
  onStatus?: (status: ConnectionStatus) => void;
  /** Testing seams — all default to the browser globals. */
  fetch?: FetchLike;
  WebSocket?: WebSocketCtor | null;
  randomUUID?: () => string;
  isHidden?: () => boolean;
  /** Poll intervals in ms (active / idle / hidden). */
  pollIntervals?: { active?: number; idle?: number; hidden?: number };
}

export interface SessionClient<S extends Snapshot = Snapshot> {
  /** Latest snapshot, or null before the first successful fetch. */
  getSnapshot(): S | null;
  getStatus(): ConnectionStatus;
  /** Force an immediate snapshot refetch. */
  refresh(): Promise<void>;
  submit(command: Command): Promise<SubmitResult>;
  close(): void;
}

/* -------------------------------------------------------------- helpers */

const WS_FAILURES_BEFORE_POLLING = 2;
const WS_BACKOFF_BASE_MS = 1000;
const WS_BACKOFF_MAX_MS = 30_000;
/**
 * Application-level keepalive. The server answers the literal text "ping" via
 * the Durable Object's setWebSocketAutoResponse pair, so the reply comes from
 * the runtime without waking (and billing) the hibernated object, while the
 * traffic keeps NATs, proxies, and the Cloudflare edge from dropping an idle
 * socket — which would otherwise force a reconnect + snapshot refetch cycle.
 */
const WS_KEEPALIVE_MS = 30_000;

function defaultOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? '';
}

function normalizeBase(baseUrl: string | undefined): string {
  const raw = baseUrl && baseUrl.length > 0 ? baseUrl : defaultOrigin();
  return raw.replace(/\/+$/, '');
}

function wsUrlFrom(httpBase: string, path: string): string {
  const base = httpBase.length > 0 ? httpBase : defaultOrigin();
  if (base.startsWith('https:')) return `wss:${base.slice(6)}${path}`;
  if (base.startsWith('http:')) return `ws:${base.slice(5)}${path}`;
  return `${base}${path}`;
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-crypto fallback: only used in environments without WebCrypto.
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

function isActiveSnapshot(snap: Snapshot | null): boolean {
  if (!snap) return false;
  const s = snap as { interactionStatus?: string | null; status?: string };
  return s.interactionStatus === 'open';
}

/* --------------------------------------------------------------- client */

export function createSessionClient<S extends Snapshot = Snapshot>(
  options: SessionClientOptions<S>,
): SessionClient<S> {
  const base = normalizeBase(options.baseUrl);
  const doFetch: FetchLike =
    options.fetch ??
    ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);
  const WSCtor: WebSocketCtor | null =
    options.WebSocket === undefined
      ? ((globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket ?? null)
      : options.WebSocket;
  const makeKey = options.randomUUID ?? uuid;
  const isHidden =
    options.isHidden ??
    (() => {
      const doc = (globalThis as { document?: { hidden?: boolean } }).document;
      return doc?.hidden === true;
    });
  const intervals = {
    active: options.pollIntervals?.active ?? 1500,
    idle: options.pollIntervals?.idle ?? 6000,
    hidden: options.pollIntervals?.hidden ?? 15_000,
  };

  const statePath = `/api/sessions/${encodeURIComponent(options.sessionCode)}/state`;
  const commandsPath = `/api/sessions/${encodeURIComponent(options.sessionCode)}/commands`;
  const wsPath = `/api/sessions/${encodeURIComponent(options.sessionCode)}/ws?token=${encodeURIComponent(options.token)}`;

  let closed = false;
  let snapshot: S | null = null;
  let knownRevision = -1;
  let status: ConnectionStatus = 'connecting';

  let ws: WebSocketLike | null = null;
  let wsFailures = 0;
  let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let fetching = false;
  let refetchQueued = false;

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    try {
      options.onStatus?.(next);
    } catch {
      /* listener errors must not break the client */
    }
  }

  function emit(snap: S): void {
    snapshot = snap;
    try {
      options.onChange?.(snap);
    } catch {
      /* listener errors must not break the client */
    }
  }

  async function fetchSnapshot(): Promise<void> {
    if (closed) return;
    if (fetching) {
      refetchQueued = true;
      return;
    }
    fetching = true;
    try {
      const q =
        `?role=${encodeURIComponent(options.role)}` +
        (knownRevision >= 0 ? `&afterRevision=${knownRevision}` : '');
      const res = await doFetch(`${base}${statePath}${q}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      });
      if (closed) return;
      if (res.status === 304) {
        if (status === 'offline') setStatus(polling ? 'polling' : 'live');
        return;
      }
      if (!res.ok) {
        setStatus('offline');
        return;
      }
      const body = (await res.json()) as S;
      if (closed) return;
      if (typeof body?.revision === 'number') knownRevision = body.revision;
      emit(body);
      if (status === 'offline' || status === 'connecting') {
        setStatus(polling ? 'polling' : ws ? 'live' : 'connecting');
      }
    } catch {
      if (!closed) setStatus('offline');
    } finally {
      fetching = false;
      if (refetchQueued && !closed) {
        refetchQueued = false;
        void fetchSnapshot();
      }
      schedulePoll();
    }
  }

  /* ----------------------------------------------------------- polling */

  function pollInterval(): number {
    if (isHidden()) return intervals.hidden;
    return isActiveSnapshot(snapshot) ? intervals.active : intervals.idle;
  }

  function schedulePoll(): void {
    if (closed || !polling) return;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void fetchSnapshot();
    }, pollInterval());
  }

  function startPolling(): void {
    if (polling || closed) return;
    polling = true;
    setStatus('polling');
    schedulePoll();
  }

  function stopPolling(): void {
    polling = false;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  /* --------------------------------------------------------- websocket */

  function stopKeepalive(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function handleWsDown(): void {
    if (closed) return;
    stopKeepalive();
    ws = null;
    wsFailures += 1;
    if (wsFailures >= WS_FAILURES_BEFORE_POLLING) startPolling();
    else setStatus('connecting');
    const delay = Math.min(
      WS_BACKOFF_MAX_MS,
      WS_BACKOFF_BASE_MS * Math.pow(2, Math.min(wsFailures - 1, 5)),
    );
    if (wsRetryTimer !== null) clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = null;
      connectWs();
    }, delay);
  }

  function connectWs(): void {
    if (closed || ws || !WSCtor) {
      if (!WSCtor && !closed) startPolling();
      return;
    }
    let sock: WebSocketLike;
    try {
      sock = new WSCtor(wsUrlFrom(base, wsPath));
    } catch {
      handleWsDown();
      return;
    }
    ws = sock;
    let settled = false;
    sock.onopen = () => {
      if (closed) {
        sock.close();
        return;
      }
      settled = true;
      wsFailures = 0;
      stopPolling();
      setStatus('live');
      stopKeepalive();
      pingTimer = setInterval(() => {
        if (ws !== sock || sock.readyState !== 1) return;
        try {
          sock.send?.('ping');
        } catch {
          // a send on a dying socket surfaces through onclose/onerror
        }
      }, WS_KEEPALIVE_MS);
      // Catch up on anything missed while disconnected.
      void fetchSnapshot();
    };
    sock.onmessage = (ev) => {
      let msg: SessionChangedMessage | null = null;
      try {
        msg =
          typeof ev.data === 'string'
            ? (JSON.parse(ev.data) as SessionChangedMessage)
            : null;
      } catch {
        msg = null;
      }
      if (!msg || msg.type !== 'session.changed') return;
      if (typeof msg.revision === 'number' && msg.revision > knownRevision) {
        void fetchSnapshot();
      }
    };
    sock.onerror = () => {
      if (settled || closed) return;
      settled = true;
      if (ws === sock) {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        handleWsDown();
      }
    };
    sock.onclose = () => {
      if (closed) return;
      if (ws === sock || !settled) {
        settled = true;
        handleWsDown();
      }
    };
  }

  /* ------------------------------------------------------------ submit */

  async function postCommand(
    key: string,
    command: Command,
  ): Promise<{ res: Awaited<ReturnType<FetchLike>> } | { networkError: true }> {
    try {
      const res = await doFetch(`${base}${commandsPath}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ idempotencyKey: key, command }),
      });
      return { res };
    } catch {
      return { networkError: true };
    }
  }

  async function submit(command: Command): Promise<SubmitResult> {
    const key = makeKey();
    let attempt = await postCommand(key, command);
    if ('networkError' in attempt) {
      // Exactly one retry, reusing the SAME idempotency key.
      attempt = await postCommand(key, command);
    }
    if ('networkError' in attempt) {
      setStatus('offline');
      return { ok: false, error: { code: 'E_NETWORK', message: 'Network error' } };
    }
    const { res } = attempt;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok) {
      const revision =
        body && typeof body === 'object' && typeof (body as { revision?: unknown }).revision === 'number'
          ? (body as { revision: number }).revision
          : knownRevision;
      // The command changed state; pull the fresh snapshot without waiting
      // for the coalesced notification.
      void fetchSnapshot();
      return { ok: true, revision };
    }
    const err =
      body && typeof body === 'object' && (body as { error?: unknown }).error
        ? ((body as { error: { code: string; message: string } }).error)
        : { code: 'E_HTTP_' + res.status, message: `Request failed (${res.status})` };
    return { ok: false, error: err };
  }

  /* ------------------------------------------------------------- start */

  try {
    options.onStatus?.('connecting');
  } catch {
    /* listener errors must not break the client */
  }
  void fetchSnapshot();
  if (WSCtor) connectWs();
  else startPolling();

  return {
    getSnapshot: () => snapshot,
    getStatus: () => status,
    refresh: () => fetchSnapshot(),
    submit,
    close(): void {
      closed = true;
      stopPolling();
      stopKeepalive();
      if (wsRetryTimer !== null) {
        clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
      }
      if (ws) {
        try {
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    },
  };
}

/* ---------------------------------------------------------------- join */

export interface JoinSessionOptions {
  /** Testing seam; defaults to the browser global. */
  fetch?: FetchLike;
  /** Existing session-local handle used to recover a pseudonymous participant. */
  recoveryHandle?: string;
  /**
   * Context access link (`orlnk_…`) for an identified (tutoring) session. It is
   * forwarded to `POST /api/join` and nowhere else: the Worker verifies it,
   * checks it belongs to this session's context, and passes only the resolved
   * display name on. Never store it alongside the returned session token.
   */
  contextLink?: string;
  /** Roster invite (`orinv_…`) for a named-seat session. Not a context access link. */
  rosterInvite?: string;
}

export async function joinSession(
  baseUrl: string,
  code: string,
  injectedFetchOrOptions?: FetchLike | JoinSessionOptions,
): Promise<JoinResult> {
  const base = normalizeBase(baseUrl);
  const options: JoinSessionOptions =
    typeof injectedFetchOrOptions === 'function'
      ? { fetch: injectedFetchOrOptions }
      : (injectedFetchOrOptions ?? {});
  const f: FetchLike =
    options.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);
  const recoveryHandle = options.recoveryHandle?.trim();
  const contextLink = options.contextLink?.trim();
  const rosterInvite = options.rosterInvite?.trim();
  const res = await f(`${base}/api/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      code: code.trim().toUpperCase(),
      ...(recoveryHandle ? { recoveryHandle } : {}),
      ...(contextLink ? { contextLink } : {}),
      ...(rosterInvite ? { rosterInvite } : {}),
    }),
  });
  if (!res.ok) {
    let message = `Could not join session (${res.status})`;
    try {
      const body = (await res.json()) as {
        error?: string | { message?: string };
        message?: string;
      };
      message =
        (typeof body?.error === 'object' ? body.error.message : undefined) ??
        body?.message ??
        message;
    } catch {
      /* keep default message */
    }
    throw new JoinError(message, res.status);
  }
  return (await res.json()) as JoinResult;
}

export class JoinError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JoinError';
    this.status = status;
  }
}
