/**
 * The deck surface of the OpenRoom control plane.
 *
 * A deck is the *content* — the plan file — and it is versioned. The browser's
 * deck editor, `openroom deck …`, the `deck_*` MCP tools and a raw API caller
 * all reach the same six routes wrapped here, because they are peer clients of
 * one application service (`AGENTS.md` §"Product architecture"). Nothing in this
 * module is browser-specific and nothing is agent-specific.
 *
 * ## Versions and drafts are different things, deliberately
 *
 * `saveVersion` stamps a numbered, **validated** version. It carries the
 * `baseVersion` the edit started from and the server refuses the write with
 * `409 version-conflict` when someone else has stamped in the meantime — so a
 * caller never silently overwrites a colleague. `DeckConflictError.latestVersion`
 * carries what the server actually has, which is what a re-base needs.
 *
 * `saveDraft` stores the editor's raw YAML working text. It is **not** validated
 * and half-typed YAML is its normal state; refusing it would turn auto-save off
 * exactly when it is wanted. Nothing that delivers a session ever reads a draft,
 * and stamping a version clears it.
 *
 * ## `start` is two calls, not one
 *
 * There is no "deliver this deck" shortcut route, because a session is a real,
 * filed delivery instance and not a side effect. `start` creates the session and
 * then launches it, which is exactly what the browser's Present button does —
 * the convenience is in the SDK, not in a shortcut route the API would have to
 * keep forever.
 */
import type { FetchLike } from './client.js';

/** A deck row as the API returns it. Content is fetched separately. */
export interface DeckSummary {
  id: string;
  spaceId: string;
  folderId: string | null;
  contextId: string | null;
  title: string;
  shape: string;
  /** Highest stamped version; `0` for a deck with no content yet. */
  currentVersion: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * A deck plus one version of its content.
 *
 * `content` is an Outline v1 document, typed here as `unknown` on purpose: this
 * package carries no dependencies, and a caller that wants the typed shape runs
 * it through `validateOutline` from `@openroom/schema`, which is the only place
 * that decides what a valid outline is.
 */
export interface DeckDetail {
  deck: DeckSummary;
  /** Names of the deck's place, for a breadcrumb; null when unresolvable. */
  spaceName: string | null;
  folderName: string | null;
  /** The version `content` was read from, or null when nothing is stamped yet. */
  contentVersion: number | null;
  contentHash: string | null;
  content: unknown;
}

export interface DeckVersionSummary {
  version: number;
  createdAt: number;
  createdBy: string;
}

/**
 * The answer to a version stamp. `unchanged` means the content was byte-identical
 * to what is already stamped, so `version` is the existing one and nothing new
 * was written — a save that costs nothing rather than a version that says nothing.
 */
export interface DeckSaveResult {
  deckId: string;
  version: number;
  contentHash: string;
  unchanged?: boolean;
}

export interface DeckFileSyncInput {
  fileId: string;
  localRevision: number;
  baseContentHash: string;
}

export interface DeckFileLocation {
  deviceId: string;
  deviceName: string;
  path: string;
  localRevision: number;
  contentHash: string;
  syncedVersion: number;
  syncedHash: string;
  lastSeenAt: number;
}

export interface DeckFileLocationInput extends Omit<DeckFileLocation, 'deviceId' | 'lastSeenAt'> {
  fileId: string;
}

export interface DeckFileLink {
  linked: boolean;
  fileId: string | null;
  /** Only locations reported by the authenticated user are returned. */
  locations: DeckFileLocation[];
}

export type ConditionalDeckDetail =
  | { changed: false; etag: string }
  | { changed: true; etag: string | null; detail: DeckDetail };

export interface DeckDraft {
  deckId: string;
  source: string;
  baseVersion: number;
  updatedAt: number;
  updatedBy: string;
}

export interface DeckDraftSaved {
  deckId: string;
  savedAt: number;
}

/** What a launched deck answers with: the live session it was filed as. */
export interface DeckStartResult {
  /** The 8-character live session code. */
  sessionCode: string;
  joinUrl: string;
  hostToken: string;
  stageToken: string;
  sessionId: string;
  deckId: string;
  deckVersion: number;
  status: string;
  started: boolean;
  /** Present only when the session was created but `session.start` failed. */
  startFailed?: string;
}

export interface DeckStartOptions {
  /** Deliver an older stamped version instead of the current one. */
  version?: number;
  /** Title for the created session; defaults to the deck's title. */
  title?: string;
  /** Create the session without starting it. */
  start?: boolean;
}

/** Uploaded media, as `MediaAssetSummary` in `@openroom/schema`. */
export interface MediaAsset {
  id: string;
  spaceId: string;
  /** Same-origin path; put straight into an outline's media `url`. */
  url: string;
  name: string;
  contentType: string;
  size: number;
  alt: string | null;
  kind: 'image' | 'video';
  createdAt: number;
  createdBy: string;
}

export interface AssetUploadOptions {
  /** Display name for the file. */
  name: string;
  /** Real media type of the bytes, e.g. `image/jpeg`. */
  contentType: string;
  alt?: string;
}

export interface DeckClientOptions {
  /** Worker origin, e.g. `https://openroom.example`. */
  baseUrl: string;
  /**
   * Personal API token (`orpat_…`) or an MCP OAuth access token. Omit in a
   * browser, where the `or_session` cookie plus the CSRF header authenticates
   * instead — pass `credentials: 'include'` through `fetch` in that case.
   */
  token?: string;
  /** Testing seam; defaults to the global. */
  fetch?: FetchLike;
}

export class DeckError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DeckError';
    this.status = status;
  }
}

/**
 * A `409` from `saveVersion`: someone stamped a version after this edit started.
 * `latestVersion` is what the server holds, so a caller can re-read, re-base and
 * offer the choice rather than guessing.
 */
export class DeckConflictError extends DeckError {
  readonly latestVersion: number | null;
  constructor(message: string, latestVersion: number | null) {
    super(message, 409);
    this.name = 'DeckConflictError';
    this.latestVersion = latestVersion;
  }
}

export interface DecksApi {
  /** One deck plus its content, at the current version or a named one. */
  get(deckId: string, options?: { version?: number }): Promise<DeckDetail>;
  getIfChanged(deckId: string, etag: string): Promise<ConditionalDeckDetail>;
  /** Every stamped version, newest first. */
  listVersions(deckId: string): Promise<DeckVersionSummary[]>;
  /** Stamp validated content. Throws `DeckConflictError` on a stale base. */
  saveVersion(
    deckId: string,
    content: unknown,
    baseVersion: number,
    fileSync?: DeckFileSyncInput,
  ): Promise<DeckSaveResult>;
  getFileLink(deckId: string): Promise<DeckFileLink>;
  linkFile(deckId: string, fileId: string): Promise<{ linked: true; fileId: string; unchanged?: boolean }>;
  reportFileLocation(deckId: string, deviceId: string, input: DeckFileLocationInput): Promise<DeckFileLocation>;
  forgetFileLocation(deckId: string, deviceId: string): Promise<void>;
  /** The rolling working text, or null when there is none. */
  getDraft(deckId: string): Promise<DeckDraft | null>;
  /** Store working text. Never validated — that is what `saveVersion` is for. */
  saveDraft(deckId: string, source: string, baseVersion: number): Promise<DeckDraftSaved>;
  /** Throw the working text away. Idempotent. */
  discardDraft(deckId: string): Promise<void>;
  /** File a session for this deck and launch it live. */
  start(deckId: string, options?: DeckStartOptions): Promise<DeckStartResult>;
}

export interface AssetsApi {
  /** Upload one file's bytes to a space's media library. */
  upload(
    spaceId: string,
    bytes: Uint8Array | ArrayBuffer,
    options: AssetUploadOptions,
  ): Promise<MediaAsset>;
  /** The space's media library, optionally filtered by a name substring. */
  list(spaceId: string, query?: string): Promise<MediaAsset[]>;
}

export interface DeckClient {
  decks: DecksApi;
  assets: AssetsApi;
}

export function createDeckClient(options: DeckClientOptions): DeckClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const f: FetchLike =
    options.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);

  function headers(mutating: boolean, contentType?: string): Record<string, string> {
    const out: Record<string, string> = { accept: 'application/json' };
    if (options.token !== undefined) out.authorization = `Bearer ${options.token}`;
    if (contentType !== undefined) out['content-type'] = contentType;
    // A cookie-authenticated browser write needs the CSRF header; a bearer
    // token does not, and sending it anyway is harmless.
    if (mutating) out['x-openroom-csrf'] = '1';
    return out;
  }

  async function call(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const method = init?.method ?? 'GET';
    const res = await f(`${base}${path}`, {
      method,
      headers: headers(method !== 'GET', init?.body === undefined ? undefined : 'application/json'),
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (res.status === 204) return null;
    const body = (await res.json().catch(() => null)) as
      | { error?: string; latestVersion?: number }
      | null;
    if (!res.ok) {
      const message = body?.error ?? `Deck request failed (${res.status})`;
      if (res.status === 409 && message === 'version-conflict') {
        throw new DeckConflictError(message, body?.latestVersion ?? null);
      }
      throw new DeckError(message, res.status);
    }
    return body;
  }

  const deckPath = (deckId: string): string =>
    `/api/decks/${encodeURIComponent(deckId)}`;

  const decks: DecksApi = {
    async get(deckId, getOptions) {
      const query =
        getOptions?.version === undefined ? '' : `?version=${String(getOptions.version)}`;
      const body = (await call(`${deckPath(deckId)}${query}`)) as DeckDetail | null;
      if (body === null || body.deck === undefined) {
        throw new DeckError('deck response carried no deck', 500);
      }
      return body;
    },
    async getIfChanged(deckId, etag) {
      const res = await f(`${base}${deckPath(deckId)}`, {
        method: 'GET',
        headers: { ...headers(false), 'if-none-match': etag },
      });
      const nextEtag = res.headers?.get('etag') ?? etag;
      if (res.status === 304) return { changed: false, etag: nextEtag };
      const body = (await res.json().catch(() => null)) as (DeckDetail & { error?: string }) | null;
      if (!res.ok || body?.deck === undefined) {
        throw new DeckError(body?.error ?? `Deck request failed (${res.status})`, res.status);
      }
      return { changed: true, etag: res.headers?.get('etag') ?? null, detail: body };
    },
    async listVersions(deckId) {
      const body = (await call(`${deckPath(deckId)}/versions`)) as
        | { versions?: DeckVersionSummary[] }
        | null;
      return body?.versions ?? [];
    },
    async saveVersion(deckId, content, baseVersion, fileSync) {
      const body = (await call(`${deckPath(deckId)}/versions`, {
        method: 'POST',
        body: { content, baseVersion, ...(fileSync === undefined ? {} : { fileSync }) },
      })) as DeckSaveResult | null;
      if (body === null) throw new DeckError('save returned no body', 500);
      return body;
    },
    async getFileLink(deckId) {
      const body = (await call(`${deckPath(deckId)}/file-link`)) as DeckFileLink | null;
      return body ?? { linked: false, fileId: null, locations: [] };
    },
    async linkFile(deckId, fileId) {
      const body = (await call(`${deckPath(deckId)}/file-link`, {
        method: 'POST', body: { fileId },
      })) as { linked: true; fileId: string; unchanged?: boolean } | null;
      if (body === null) throw new DeckError('file link returned no body', 500);
      return body;
    },
    async reportFileLocation(deckId, deviceId, input) {
      const body = (await call(
        `${deckPath(deckId)}/file-locations/${encodeURIComponent(deviceId)}`,
        { method: 'PUT', body: input },
      )) as { location?: DeckFileLocation } | null;
      if (body?.location === undefined) throw new DeckError('file location returned no body', 500);
      return body.location;
    },
    async forgetFileLocation(deckId, deviceId) {
      await call(`${deckPath(deckId)}/file-locations/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    },
    async getDraft(deckId) {
      try {
        return (await call(`${deckPath(deckId)}/draft`)) as DeckDraft;
      } catch (error) {
        // No draft is a normal state, not a failure — the deck simply has no
        // unsaved working text. Any other status is still an error.
        if (error instanceof DeckError && error.status === 404) return null;
        throw error;
      }
    },
    async saveDraft(deckId, source, baseVersion) {
      const body = (await call(`${deckPath(deckId)}/draft`, {
        method: 'PUT',
        body: { source, baseVersion },
      })) as DeckDraftSaved | null;
      if (body === null) throw new DeckError('draft save returned no body', 500);
      return body;
    },
    async discardDraft(deckId) {
      await call(`${deckPath(deckId)}/draft`, { method: 'DELETE' });
    },
    async start(deckId, startOptions) {
      const created = (await call('/api/sessions', {
        method: 'POST',
        body: {
          deckId,
          ...(startOptions?.version === undefined ? {} : { deckVersion: startOptions.version }),
          ...(startOptions?.title === undefined ? {} : { title: startOptions.title }),
        },
      })) as { session?: { id?: string } } | null;
      const sessionId = created?.session?.id;
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new DeckError('session creation returned no session id', 500);
      }
      const launched = (await call(
        `/api/sessions/${encodeURIComponent(sessionId)}/launch`,
        { method: 'POST', body: { start: startOptions?.start !== false } },
      )) as DeckStartResult | null;
      if (launched === null) throw new DeckError('launch returned no body', 500);
      return launched;
    },
  };

  const assets: AssetsApi = {
    async upload(spaceId, bytes, uploadOptions) {
      const query = new URLSearchParams({ name: uploadOptions.name });
      if (uploadOptions.alt !== undefined && uploadOptions.alt !== '') {
        query.set('alt', uploadOptions.alt);
      }
      const res = await f(
        `${base}/api/tutoring/spaces/${encodeURIComponent(spaceId)}/assets?${query.toString()}`,
        {
          method: 'POST',
          headers: headers(true, uploadOptions.contentType),
          body: bytes,
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { asset?: MediaAsset; error?: string }
        | null;
      if (!res.ok || body?.asset === undefined) {
        throw new DeckError(body?.error ?? `Asset upload failed (${res.status})`, res.status);
      }
      return body.asset;
    },
    async list(spaceId, query) {
      const suffix = query === undefined || query === '' ? '' : `?query=${encodeURIComponent(query)}`;
      const body = (await call(
        `/api/tutoring/spaces/${encodeURIComponent(spaceId)}/assets${suffix}`,
      )) as { assets?: MediaAsset[] } | null;
      return body?.assets ?? [];
    },
  };

  return { decks, assets };
}
