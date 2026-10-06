import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { SessionError } from './types.js';
import { ErrorCodes } from './types.js';
import type { Outline } from './outline-types.js';
import { validateOutline } from './outline.js';
import { mapOutlineResourceSources, type OutlineResourceSource } from './outline-resources.js';

export const OPENROOM_FILE_FORMAT = 'openroom-file' as const;
export const OPENROOM_FILE_VERSION = 1 as const;

export interface OpenRoomRemoteLinkV1 {
  origin: string;
  deckId: string;
  baseVersion: number;
  baseContentHash: string;
  /** Common ancestor for deterministic three-way merge on any computer that opens the file. */
  baseOutline: Outline;
}

export const OPENROOM_RESOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const OPENROOM_RESOURCE_TOTAL_MAX_BYTES = 50 * 1024 * 1024;
export const OPENROOM_RESOURCE_MAX_COUNT = 100;
export const OPENROOM_PDF_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
export const OPENROOM_RESOURCE_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
] as const;

export type OpenRoomResourceContentType = (typeof OPENROOM_RESOURCE_CONTENT_TYPES)[number];

export interface OpenRoomOnlineResource {
  kind: 'openroom-asset';
  assetId: string;
  /** Hash of the bytes behind assetId; a changed package resource must upload again. */
  sha256: string;
}

export interface OpenRoomFileResourceV1 {
  /** POSIX ZIP entry below resources/. */
  path: string;
  name: string;
  contentType: OpenRoomResourceContentType;
  size: number;
  sha256: string;
  /** Present only after a linked file has retained these bytes in R2. */
  online?: OpenRoomOnlineResource;
}

export interface OpenRoomFileV1 {
  format: typeof OPENROOM_FILE_FORMAT;
  fileVersion: typeof OPENROOM_FILE_VERSION;
  fileId: string;
  localRevision: number;
  remote?: OpenRoomRemoteLinkV1;
  resources?: Record<string, OpenRoomFileResourceV1>;
  outline: Outline;
}

export type OpenRoomFileParseResult =
  | { ok: true; file: OpenRoomFileV1 }
  | { ok: false; errors: SessionError[] };

export type OpenRoomFileMaterializeResult =
  | { ok: true; outline: Outline }
  | { ok: false; errors: SessionError[] };

export interface OutlineMergeConflict {
  path: string;
  reason: 'different-edits' | 'edit-delete' | 'competing-order';
}

export type OutlineMergeResult =
  | { ok: true; outline: Outline }
  | { ok: false; conflicts: OutlineMergeConflict[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function issue(path: string, message: string): SessionError {
  return { code: ErrorCodes.E_SCHEMA, path, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRelativePath(value: string): boolean {
  if (value === '' || value.includes('\\') || value.startsWith('/')) return false;
  if (/^[a-z]:/i.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function validateEnvelope(raw: unknown): SessionError[] {
  if (!isObject(raw)) return [issue('/', 'OpenRoom file must be an object')];
  const errors: SessionError[] = [];
  const allowed = new Set(['format', 'fileVersion', 'fileId', 'localRevision', 'remote', 'resources', 'outline']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errors.push(issue(`/${key}`, `unknown OpenRoom file property "${key}"`));
  }
  if (raw['format'] !== OPENROOM_FILE_FORMAT) errors.push(issue('/format', `must be "${OPENROOM_FILE_FORMAT}"`));
  if (raw['fileVersion'] !== OPENROOM_FILE_VERSION) errors.push(issue('/fileVersion', 'unsupported OpenRoom file version'));
  if (typeof raw['fileId'] !== 'string' || !UUID_PATTERN.test(raw['fileId'])) {
    errors.push(issue('/fileId', 'must be a UUID'));
  }
  if (!Number.isInteger(raw['localRevision']) || (raw['localRevision'] as number) < 0) {
    errors.push(issue('/localRevision', 'must be a non-negative integer'));
  }
  if (!isObject(raw['outline'])) errors.push(issue('/outline', 'must contain an outline'));

  const remote = raw['remote'];
  if (remote !== undefined) {
    if (!isObject(remote)) {
      errors.push(issue('/remote', 'must be an object'));
    } else {
      const keys = new Set(['origin', 'deckId', 'baseVersion', 'baseContentHash', 'baseOutline']);
      for (const key of Object.keys(remote)) {
        if (!keys.has(key)) errors.push(issue(`/remote/${key}`, `unknown remote-link property "${key}"`));
      }
      try {
        const origin = new URL(String(remote['origin']));
        const localDevelopment = origin.protocol === 'http:'
          && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
        if ((origin.protocol !== 'https:' && !localDevelopment)
          || origin.username !== '' || origin.password !== ''
          || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
          throw new Error('bad origin');
        }
      } catch {
        errors.push(issue('/remote/origin', 'must be an HTTPS origin (HTTP is allowed only on loopback) without credentials, a path, query, or fragment'));
      }
      if (typeof remote['deckId'] !== 'string' || remote['deckId'] === '') {
        errors.push(issue('/remote/deckId', 'must be a non-empty deck id'));
      }
      if (!Number.isInteger(remote['baseVersion']) || (remote['baseVersion'] as number) < 0) {
        errors.push(issue('/remote/baseVersion', 'must be a non-negative integer'));
      }
      if (typeof remote['baseContentHash'] !== 'string' || !SHA256_PATTERN.test(remote['baseContentHash'])) {
        errors.push(issue('/remote/baseContentHash', 'must be a lowercase SHA-256 hash'));
      }
      const baseOutline = validateOutline(remote['baseOutline']);
      if (!baseOutline.ok) {
        errors.push(...baseOutline.errors.map((error) => issue(`/remote/baseOutline${error.path}`, error.message)));
      }
    }
  }

  const resources = raw['resources'];
  if (resources !== undefined) {
    if (!isObject(resources)) {
      errors.push(issue('/resources', 'must be an object'));
    } else {
      if (Object.keys(resources).length > OPENROOM_RESOURCE_MAX_COUNT) {
        errors.push(issue('/resources', `must contain at most ${String(OPENROOM_RESOURCE_MAX_COUNT)} resources`));
      }
      let totalSize = 0;
      for (const [resourceId, value] of Object.entries(resources)) {
        const path = `/resources/${resourceId}`;
        if (!UUID_PATTERN.test(resourceId) || !isObject(value)) {
          errors.push(issue(path, 'must be a named resource object'));
          continue;
        }
        const allowedResource = new Set(['path', 'name', 'contentType', 'size', 'sha256', 'online']);
        for (const key of Object.keys(value)) {
          if (!allowedResource.has(key)) errors.push(issue(`${path}/${key}`, 'unknown resource property'));
        }
        const entryPath = value['path'];
        if (
          typeof entryPath !== 'string' ||
          !validRelativePath(entryPath) ||
          !entryPath.startsWith(`resources/${resourceId}.`)
        ) {
          errors.push(issue(`${path}/path`, 'must be a resources/{resourceId}.ext ZIP entry'));
        }
        if (typeof value['name'] !== 'string' || value['name'].trim() === '' || value['name'].length > 200) {
          errors.push(issue(`${path}/name`, 'must be a non-empty name of at most 200 characters'));
        }
        if (!(OPENROOM_RESOURCE_CONTENT_TYPES as readonly unknown[]).includes(value['contentType'])) {
          errors.push(issue(`${path}/contentType`, 'must be a supported image or PDF content type'));
        }
        const size = value['size'];
        if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > OPENROOM_RESOURCE_MAX_BYTES) {
          errors.push(issue(`${path}/size`, `must be between 1 and ${String(OPENROOM_RESOURCE_MAX_BYTES)} bytes`));
        } else {
          totalSize += size as number;
        }
        if (typeof value['sha256'] !== 'string' || !SHA256_PATTERN.test(value['sha256'])) {
          errors.push(issue(`${path}/sha256`, 'must be a lowercase SHA-256 hash'));
        }
        const online = value['online'];
        if (online === undefined) continue;
        if (!isObject(online) || online['kind'] !== 'openroom-asset') {
          errors.push(issue(`${path}/online`, 'must be an OpenRoom asset reference'));
          continue;
        }
        if (typeof online['assetId'] !== 'string' || online['assetId'] === '') {
          errors.push(issue(`${path}/online/assetId`, 'must be a non-empty asset id'));
        }
        if (typeof online['sha256'] !== 'string' || !SHA256_PATTERN.test(online['sha256'])) {
          errors.push(issue(`${path}/online/sha256`, 'must be a lowercase SHA-256 hash'));
        }
      }
      if (totalSize > OPENROOM_RESOURCE_TOTAL_MAX_BYTES) {
        errors.push(issue('/resources', `total resource size must not exceed ${String(OPENROOM_RESOURCE_TOTAL_MAX_BYTES)} bytes`));
      }
    }
  }
  return errors;
}

type ResourceSource = OutlineResourceSource;

function materializeSource<T extends ResourceSource>(
  source: T,
  resources: Record<string, OpenRoomFileResourceV1>,
  path: string,
  allowLocalPlaceholder: boolean,
): { source?: T; error?: SessionError } {
  if (source.resourceId === undefined) return { source };
  const resource = resources[source.resourceId];
  if (resource === undefined) return { error: issue(path, `unknown embedded resource "${source.resourceId}"`) };
  if (path.includes('/design/') && !resource.contentType.startsWith('image/')) {
    return { error: issue(path, 'a background or logo must reference an image resource') };
  }
  const { resourceId, ...presentation } = source;
  // Local bytes stay authoritative in the editor, even after a linked file has uploaded them.
  if (allowLocalPlaceholder) {
    const { assetId: _asset, ...local } = presentation;
    return { source: { ...local, url: `https://local.openroom.invalid/${encodeURIComponent(resourceId)}` } as T };
  }
  if (resource.online?.kind === 'openroom-asset' && resource.online.sha256 === resource.sha256) {
    return {
      source: {
        ...presentation,
        assetId: resource.online.assetId,
        url: `/api/assets/${encodeURIComponent(resource.online.assetId)}`,
      } as T,
    };
  }
  return { error: issue(path, `embedded resource "${resourceId}" must be uploaded before syncing`) };
}

function materialize(
  file: OpenRoomFileV1,
  allowLocalPlaceholder: boolean,
): OpenRoomFileMaterializeResult {
  // A manifest is untrusted input: validate the shape before walking its media graph.
  const authored = validateOutline(file.outline);
  if (!authored.ok) return { ok: false, errors: authored.errors.map((error) => ({ ...error, path: `/outline${error.path}` })) };
  const resources = file.resources ?? {};
  const errors: SessionError[] = [];
  const outline = mapOutlineResourceSources(authored.outline, (source, path) => {
    const result = materializeSource(source, resources, `/outline${path}`, allowLocalPlaceholder);
    if (result.error) errors.push(result.error);
    return result.source ?? source;
  });
  if (errors.length > 0) return { ok: false, errors };
  const validation = validateOutline(outline);
  return validation.ok ? { ok: true, outline: validation.outline } : { ok: false, errors: validation.errors };
}

/** Parse the deck.yaml manifest from a teacher-owned .openroom package. */
export function parseOpenRoomFile(text: string): OpenRoomFileParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return { ok: false, errors: [{ code: ErrorCodes.E_PARSE, path: '/', message: error instanceof Error ? error.message : String(error) }] };
  }
  const envelopeErrors = validateEnvelope(raw);
  if (envelopeErrors.length > 0) return { ok: false, errors: envelopeErrors };
  const file = raw as unknown as OpenRoomFileV1;
  const outline = materialize(file, true);
  return outline.ok ? { ok: true, file } : { ok: false, errors: outline.errors };
}

/** Convert a local file to the ordinary Outline contract accepted by D1/version APIs. */
export function materializeOpenRoomFile(file: OpenRoomFileV1): OpenRoomFileMaterializeResult {
  return materialize(file, false);
}

/** The package-native outline used to initialize an ephemeral live session. */
export function embeddedOutlineForOpenRoomFile(file: OpenRoomFileV1): Outline {
  return structuredClone(file.outline);
}

/** Stable embedded resource ids referenced anywhere in the document. */
export function outlineResourceIds(outline: Outline): string[] {
  const ids = new Set<string>();
  mapOutlineResourceSources(outline, (source) => { if (source.resourceId) ids.add(source.resourceId); return source; });
  return [...ids];
}

/** Materialize a file for the visual editor, including stable local-media placeholders. */
export function editableOutlineForOpenRoomFile(file: OpenRoomFileV1): Outline {
  const result = materialize(file, true);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  }
  return result.outline;
}

const LOCAL_RESOURCE_ORIGIN = 'https://local.openroom.invalid/';

function restoreLocalSource<T extends ResourceSource>(
  source: T,
  resources: Record<string, OpenRoomFileResourceV1>,
): T {
  let resourceId: string | undefined;
  if (source.url?.startsWith(LOCAL_RESOURCE_ORIGIN)) {
    try { resourceId = decodeURIComponent(source.url.slice(LOCAL_RESOURCE_ORIGIN.length)); }
    catch { return source; }
  } else {
    resourceId = Object.entries(resources).find(([, resource]) => resource.online?.sha256 === resource.sha256
      && (source.assetId === resource.online.assetId || source.url === `/api/assets/${encodeURIComponent(resource.online.assetId)}`))?.[0];
  }
  if (resourceId === undefined || resources[resourceId] === undefined) return source;
  const { url: _url, assetId: _asset, ...presentation } = source;
  return { ...presentation, resourceId } as T;
}

/** Put a visually edited outline back into its envelope without losing local media references. */
export function updateOpenRoomFileOutline(file: OpenRoomFileV1, outline: Outline): OpenRoomFileV1 {
  const resources = file.resources ?? {};
  return { ...file, outline: mapOutlineResourceSources(outline, (source) => restoreLocalSource(source, resources)) };
}

export function stringifyOpenRoomFile(file: OpenRoomFileV1): string {
  return stringifyYaml(file, { lineWidth: 100 });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function canonicalOutlineJson(outline: Outline): string {
  return canonicalJson(outline);
}

export async function outlineContentHash(outline: Outline): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalOutlineJson(outline));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

const MISSING = Symbol('missing');
type MaybeMissing = unknown | typeof MISSING;

function keyedArray(value: unknown[]): value is Array<Record<string, unknown> & { id: string }> {
  return value.every((item) => isObject(item) && typeof item['id'] === 'string');
}

function mergeValue(
  base: MaybeMissing,
  local: MaybeMissing,
  remote: MaybeMissing,
  path: string,
  conflicts: OutlineMergeConflict[],
): MaybeMissing {
  if (local !== MISSING && remote !== MISSING && equal(local, remote)) return local;
  if (base !== MISSING && local !== MISSING && equal(base, local)) return remote;
  if (base !== MISSING && remote !== MISSING && equal(base, remote)) return local;
  if (base === MISSING) {
    if (local === MISSING) return remote;
    if (remote === MISSING) return local;
    conflicts.push({ path, reason: 'different-edits' });
    return local;
  }
  if (local === MISSING || remote === MISSING) {
    conflicts.push({ path, reason: 'edit-delete' });
    return local;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if (keyedArray(base) && keyedArray(local) && keyedArray(remote)) {
      const ids = new Set([...base, ...local, ...remote].map((item) => item.id));
      const baseMap = new Map(base.map((item) => [item.id, item]));
      const localMap = new Map(local.map((item) => [item.id, item]));
      const remoteMap = new Map(remote.map((item) => [item.id, item]));
      const baseOrder = base.map((item) => item.id);
      const localOrder = local.map((item) => item.id);
      const remoteOrder = remote.map((item) => item.id);
      let order: string[];
      if (equal(localOrder, remoteOrder)) order = localOrder;
      else if (equal(baseOrder, localOrder)) order = remoteOrder;
      else if (equal(baseOrder, remoteOrder)) order = localOrder;
      else {
        conflicts.push({ path, reason: 'competing-order' });
        order = localOrder;
      }
      for (const id of ids) if (!order.includes(id)) order.push(id);
      return order.flatMap((id) => {
        const merged = mergeValue(baseMap.get(id) ?? MISSING, localMap.get(id) ?? MISSING, remoteMap.get(id) ?? MISSING, `${path}/${id}`, conflicts);
        return merged === MISSING ? [] : [merged];
      });
    }
    conflicts.push({ path, reason: 'different-edits' });
    return local;
  }
  if (isObject(base) && isObject(local) && isObject(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const merged = mergeValue(
        key in base ? base[key] : MISSING,
        key in local ? local[key] : MISSING,
        key in remote ? remote[key] : MISSING,
        `${path}/${key}`,
        conflicts,
      );
      if (merged !== MISSING) result[key] = merged;
    }
    return result;
  }
  conflicts.push({ path, reason: 'different-edits' });
  return local;
}

/** Conservative semantic merge for immutable Outline versions. */
export function mergeOutlines(base: Outline, local: Outline, remote: Outline): OutlineMergeResult {
  const conflicts: OutlineMergeConflict[] = [];
  const merged = mergeValue(base, local, remote, '', conflicts);
  if (conflicts.length > 0 || !isObject(merged)) return { ok: false, conflicts };
  const validation = validateOutline(merged);
  if (!validation.ok) {
    return {
      ok: false,
      conflicts: validation.errors.map((error) => ({ path: error.path, reason: 'different-edits' as const })),
    };
  }
  return { ok: true, outline: validation.outline };
}
