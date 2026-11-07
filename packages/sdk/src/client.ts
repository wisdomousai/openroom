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
     * envelope (see `decks.ts` / `apps/workspace-worker/src/assets.ts`).
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
  /**
   * The server refused this token for this session for good: 401, 403, 404 or
   * 410 on consecutive snapshot reads at least 1.5 s apart. The token expired, the session was
   * wiped, or it never existed, so retrying cannot help. When this listener is
   * set the client stops polling and closes the socket before calling it with
   * the HTTP status. Without it such a response reads as `offline` and polling
   * goes on.
   */
  onGone?: (httpStatus: number) => void;
  /** Testing seams — all default to the browser globals. */
  fetch?: FetchLike;
  WebSocket?: WebSocketCtor | null;
  randomUUID?: () => string;
  isHidden?: () => boolean;
  /**
   * Calls `wake` when the device may have its connection back, and returns an
   * unsubscribe: 'online' when the network comes back, 'visible' when the page
   * returns after long enough hidden that a socket may have died. Defaults to
   * the window `online` event and the document's visibilitychange; outside a
   * browser it does nothing.
   */
  subscribeWake?: (wake: (reason: WakeReason) => void) => () => void;
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

/** Snapshot responses that mean the token or the session is gone, not the network. */
const GONE_STATUSES = new Set([401, 403, 404, 410]);
/**
 * A gone answer must still hold this long later before the client gives up,
 * so two reads inside one stray 404 do not drop a seat.
 */
const GONE_RECHECK_MS = 1500;
/** A state read that has not answered by then is treated as a lost network. */
const FETCH_TIMEOUT_MS = 10_000;

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

export type WakeReason = 'online' | 'visible';

interface EventSourceLike {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** A phone coming back from sleep or a dead zone, in a browser. */
function browserWake(wake: (reason: WakeReason) => void): () => void {
  const win = globalThis as EventSourceLike & { document?: EventSourceLike & { hidden?: boolean } };
  const doc = win.document;
  if (typeof win.addEventListener !== 'function' || doc === undefined) return () => {};
  const onOnline = (): void => wake('online');
  let hiddenAt: number | null = null;
  const onVisible = (): void => {
    if (doc.hidden === true) {
      hiddenAt = Date.now();
      return;
    }
    // A quick tab switch keeps a healthy socket; a sleep may have killed it.
    if (hiddenAt !== null && Date.now() - hiddenAt >= WS_KEEPALIVE_MS) wake('visible');
    hiddenAt = null;
  };
  win.addEventListener('online', onOnline);
  doc.addEventListener?.('visibilitychange', onVisible);
  return () => {
    win.removeEventListener?.('online', onOnline);
    doc.removeEventListener?.('visibilitychange', onVisible);
  };
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
  /** When the current run of gone answers began; null after any other outcome. */
  let goneSince: number | null = null;
  let goneTimer: ReturnType<typeof setTimeout> | null = null;
  /** While offline over an open socket nothing else would ask again. */
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    if (next !== 'offline' && recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
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
    // A read hung on a dead network must not block every later recovery.
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const abortTimer = abort ? setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const q =
        `?role=${encodeURIComponent(options.role)}` +
        (knownRevision >= 0 ? `&afterRevision=${knownRevision}` : '');
      const res = await doFetch(`${base}${statePath}${q}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
        ...(abort ? { signal: abort.signal } : {}),
      });
      if (closed) return;
      if (res.status === 304) {
        goneSince = null;
        if (status === 'offline') setStatus(polling ? 'polling' : ws ? 'live' : 'connecting');
        return;
      }
      if (!res.ok) {
        if (GONE_STATUSES.has(res.status) && options.onGone) {
          const now = Date.now();
          goneSince ??= now;
          if (now - goneSince < GONE_RECHECK_MS) {
            if (goneTimer === null) {
              goneTimer = setTimeout(() => {
                goneTimer = null;
                void fetchSnapshot();
              }, goneSince + GONE_RECHECK_MS - now);
            }
            return;
          }
          shutdown();
          try {
            options.onGone(res.status);
          } catch {
            /* listener errors must not break the client */
          }
          return;
        }
        goneSince = null;
        setStatus('offline');
        return;
      }
      goneSince = null;
      const body = (await res.json()) as S;
      if (closed) return;
      if (typeof body?.revision === 'number') knownRevision = body.revision;
      emit(body);
      if (status === 'offline' || status === 'connecting') {
        setStatus(polling ? 'polling' : ws ? 'live' : 'connecting');
      }
    } catch {
      goneSince = null;
      if (!closed) setStatus('offline');
    } finally {
      if (abortTimer !== null) clearTimeout(abortTimer);
      fetching = false;
      if (refetchQueued && !closed) {
        refetchQueued = false;
        void fetchSnapshot();
      }
      schedulePoll();
      scheduleRecovery();
    }
  }

  /* ---------------------------------------------------------- recovery */

  function scheduleRecovery(): void {
    if (closed || polling || status !== 'offline' || recoveryTimer !== null) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void fetchSnapshot();
    }, isHidden() ? intervals.hidden : intervals.idle);
  }

  /**
   * The device says it may be back: ask now instead of at the next timer. Only
   * the network coming back skips the socket backoff and replaces the socket,
   * which a network change can leave open but dead.
   */
  function wake(reason: WakeReason): void {
    if (closed) return;
    void fetchSnapshot();
    if (reason !== 'online' || !WSCtor) return;
    if (wsRetryTimer !== null) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    if (ws !== null) {
      const stale = ws;
      ws = null;
      stopKeepalive();
      stale.onopen = null;
      stale.onclose = null;
      stale.onerror = null;
      stale.onmessage = null;
      try {
        stale.close();
      } catch {
        /* ignore */
      }
    }
    wsFailures = 0;
    connectWs();
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
    // Offline stays offline until a poll actually gets through.
    if (status !== 'offline') setStatus('polling');
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
    else if (status !== 'offline') setStatus('connecting');
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
      scheduleRecovery();
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

  /* ------------------------------------------------------------ close */

  function shutdown(): void {
    closed = true;
    stopPolling();
    stopKeepalive();
    if (wsRetryTimer !== null) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    if (goneTimer !== null) {
      clearTimeout(goneTimer);
      goneTimer = null;
    }
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    unsubscribeWake();
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
  }

  /* ------------------------------------------------------------- start */

  try {
    options.onStatus?.('connecting');
  } catch {
    /* listener errors must not break the client */
  }
  const unsubscribeWake = (options.subscribeWake ?? browserWake)(wake);
  void fetchSnapshot();
  if (WSCtor) connectWs();
  else startPolling();

  return {
    getSnapshot: () => snapshot,
    getStatus: () => status,
    refresh: () => fetchSnapshot(),
    submit,
    close: shutdown,
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
  /** Guest link (`orinv_…`) for a named-seat session. Not a context access link. */
  guestLink?: string;
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
  const guestLink = options.guestLink?.trim();
  const res = await f(`${base}/api/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      code: code.trim().toUpperCase(),
      ...(recoveryHandle ? { recoveryHandle } : {}),
      ...(contextLink ? { contextLink } : {}),
      ...(guestLink ? { guestLink } : {}),
    }),
  });
  if (!res.ok) {
    let message = `Could not join session (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: string | { message?: string };
        message?: string;
      };
      if (typeof body?.error === 'string') code = body.error;
      message =
        (typeof body?.error === 'object' ? body.error.message : undefined) ??
        body?.message ??
        message;
    } catch {
      /* keep default message */
    }
    throw new JoinError(message, res.status, code);
  }
  return (await res.json()) as JoinResult;
}

export class JoinError extends Error {
  readonly status: number;
  /** The server's stable error code, e.g. `session-full`, when it sent one. */
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'JoinError';
    this.status = status;
    this.code = code;
  }
}
