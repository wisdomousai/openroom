/**
 * Shared enums for the tutoring control plane (contexts, decks, sessions).
 * Single source of truth for the worker, host console, CLI, and MCP so a new
 * kind/shape/status lands in one place instead of drifting across clients.
 */

export const CONTEXT_KINDS = ['person', 'group', 'class', 'event', 'other'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const DECK_SHAPES = [
  'tutoring',
  'lecture',
  'meeting',
  'event',
  'interaction',
  'other',
] as const;
export type DeckShape = (typeof DECK_SHAPES)[number];

/** 'live' and 'ended' are server-owned transitions (launch / session end). */
export const SESSION_STATUSES = ['draft', 'live', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Statuses a client may set directly on a session. */
export const SESSION_STATUSES_CLIENT_WRITABLE = ['draft'] as const;

/**
 * The rolling draft behind the deck editor's hybrid save
 * (`PUT|GET|DELETE /api/decks/{id}/draft`).
 *
 * A draft is working text, not content: `source` is the editor's YAML exactly
 * as typed and may not parse. Only `POST .../versions` validates and only a
 * version can launch a live session, so nothing that reads a deck for delivery ever
 * reads a draft. Stamping a version clears it.
 */
export interface DeckDraftRequest {
  /** Editor source (YAML). Not validated; may be transiently unparseable. */
  source: string;
  /** The numbered version this working text branched from. */
  baseVersion: number;
}

export interface DeckDraftResponse {
  deckId: string;
  source: string;
  baseVersion: number;
  updatedAt: number;
  updatedBy: string;
}

/** Answer to a successful draft PUT — `savedAt` is the server's ack time. */
export interface DeckDraftSavedResponse {
  deckId: string;
  savedAt: number;
}

/** Ceiling on one draft's `source`, in UTF-16 code units. Mirrors the worker. */
export const DECK_DRAFT_MAX_CHARS = 256 * 1024;

/* ------------------------------------------------------------ media assets */

/**
 * Uploaded media ("Your files" in the deck editor media library).
 *
 * Upload is a raw-body PUT-style POST rather than multipart: the browser has
 * one `File`, the worker wants its bytes, and multipart would mean parsing a
 * body format to recover exactly what `File.stream()` already is. The file name
 * and the offered alt text ride as query parameters, which keeps the body the
 * bytes and nothing else:
 *
 *   POST /api/tutoring/spaces/{spaceId}/assets?name=gare.jpg&alt=A%20station
 *   Content-Type: image/jpeg
 *   <bytes>
 */
export const MEDIA_ASSET_MAX_BYTES = 20 * 1024 * 1024;

/**
 * What may be uploaded. Images of any subtype the browser will render, plus
 * MP4 for video — the one container every target surface can play without a
 * transcode plane behind it.
 */
export const MEDIA_ASSET_VIDEO_TYPES = ['video/mp4'] as const;
export const MEDIA_ASSET_AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav'] as const;

/** True when `contentType` is an accepted upload type. */
export function isMediaAssetContentType(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('image/') ||
    type === 'application/pdf' ||
    (MEDIA_ASSET_VIDEO_TYPES as readonly string[]).includes(type) ||
    (MEDIA_ASSET_AUDIO_TYPES as readonly string[]).includes(type)
  );
}

/**
 * The public read path for an asset.
 *
 * Unauthenticated by design: the id is an unguessable UUID and acts as the
 * capability, so the stage, a participant phone, and a learner holding no
 * session can all render the same picture (see apps/worker/src/assets.ts).
 */
export function mediaAssetPath(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}`;
}

export interface MediaAssetSummary {
  id: string;
  spaceId: string;
  /** Same-origin path; put straight into `OutlineMedia.url`. */
  url: string;
  name: string;
  contentType: string;
  size: number;
  alt: string | null;
  /** Derived from `contentType` for the picker. */
  kind: 'image' | 'video' | 'audio' | 'pdf';
  createdAt: number;
  createdBy: string;
}

export interface MediaAssetUploadResponse {
  asset: MediaAssetSummary;
}

export interface MediaAssetListResponse {
  assets: MediaAssetSummary[];
}
