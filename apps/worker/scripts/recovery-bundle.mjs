/** Checksummed local recovery bundle for a stopped D1 export and its retained R2 objects. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Headers } from 'miniflare';
import { recoveryMediaInventory } from '../src/operations/recovery.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;

export async function captureRecoveryBundle(db, bucket, schemaFile, dataFile, directory, capturedAt) {
  await mkdir(directory, { mode: 0o700 });
  await mkdir(resolve(directory, 'objects'), { mode: 0o700 });
  const manifest = { version: 1, capturedAt, database: {}, objects: [] };
  for (const [kind, file] of [['schema', schemaFile], ['data', dataFile]]) {
    const bytes = await readFile(file);
    await writeFile(resolve(directory, `${kind}.sql`), bytes, { flag: 'wx', mode: 0o600 });
    manifest.database[kind] = { sha256: hash(bytes), bytes: bytes.length };
  }
  // A paid capture can exist before its D1 pointer succeeds. Never silently omit it.
  const archiveRows = await db.prepare('SELECT r2_key FROM session_archives').all();
  const indexedArchives = new Set(archiveRows.results.map(row => row.r2_key));
  let cursor;
  do {
    const page = await bucket.list({ prefix: 'archives/', ...(cursor ? { cursor } : {}) });
    if (page.objects.some(object => !indexedArchives.has(object.key))) throw new Error('Repair unindexed session captures before taking a backup');
    if (!page.truncated) break;
    if (!page.cursor || page.cursor === cursor) throw new Error('Incomplete recovery archive inventory');
    cursor = page.cursor;
  } while (true);
  const { results } = await db.prepare(recoveryMediaInventory(capturedAt)).all();
  const seen = new Set();
  for (const row of results) {
    if (seen.has(row.object_key)) throw new Error('Recovery inventory has a duplicate object reference');
    seen.add(row.object_key);
    const object = await bucket.get(row.object_key);
    if (!object) throw new Error('Recovery inventory references missing media');
    const bytes = Buffer.from(await object.arrayBuffer());
    if (row.byte_length !== null && bytes.length !== row.byte_length) throw new Error('Recovery media size does not match D1');
    const sha256 = hash(bytes), file = hash(row.object_key);
    if (row.expected_sha256 !== null && row.expected_sha256 !== sha256) throw new Error('Recovery audio checksum does not match D1');
    await writeFile(resolve(directory, 'objects', file), bytes, { flag: 'wx', mode: 0o600 });
    manifest.objects.push({ key: row.object_key, file, sha256, bytes: bytes.length, retainedUntil: row.retained_until, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
  }
  // A partially written directory is never advertised as a complete backup.
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return manifest;
}

export async function verifyRecoveryBundle(directory, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid recovery time');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Number.isSafeInteger(manifest.capturedAt) || manifest.capturedAt <= 0 || !Array.isArray(manifest.objects)
    || !manifest.database || typeof manifest.database !== 'object') throw new Error('Invalid recovery manifest');
  for (const kind of ['schema', 'data']) {
    const info = manifest.database[kind];
    if (!digestPattern.test(info?.sha256) || !Number.isSafeInteger(info?.bytes) || info.bytes < 0) throw new Error('Invalid recovery database manifest');
    const bytes = await readFile(resolve(directory, `${kind}.sql`));
    if (hash(bytes) !== info.sha256 || bytes.length !== info.bytes) throw new Error('Recovery database checksum failed');
  }
  const seen = new Set();
  for (const item of manifest.objects) {
    if (typeof item.key !== 'string' || !item.key || seen.has(item.key) || !digestPattern.test(item.file)
      || item.file !== hash(item.key) || !digestPattern.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0
      || (item.retainedUntil !== null && (!Number.isSafeInteger(item.retainedUntil) || item.retainedUntil <= 0))) throw new Error('Invalid recovery object manifest');
    seen.add(item.key);
    // Retention may remove these backup bytes before the rest of the snapshot expires.
    if (item.retainedUntil !== null && item.retainedUntil <= now) continue;
    const bytes = await readFile(resolve(directory, 'objects', item.file));
    if (hash(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error('Recovery object checksum failed');
  }
  return manifest;
}

export async function restoreRecoveryMedia(bucket, directory, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid recovery time');
  const manifest = await verifyRecoveryBundle(directory, now);
  // No overlay restores: stale objects or a wrong target must not be silently retained.
  if ((await bucket.list({ limit: 1 })).objects.length) throw new Error('Recovery target bucket must be empty');
  for (const item of manifest.objects) {
    if (item.retainedUntil !== null && item.retainedUntil <= now) continue;
    const bytes = await readFile(resolve(directory, 'objects', item.file));
    const httpMetadata = { ...item.httpMetadata };
    if (httpMetadata.cacheExpiry !== undefined) {
      httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
      if (!Number.isFinite(httpMetadata.cacheExpiry.getTime())) throw new Error('Invalid recovery cache expiry');
    }
    const saved = await bucket.put(item.key, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata, customMetadata: item.customMetadata });
    if (!saved) throw new Error('Recovery target changed during restore');
    const restored = await bucket.get(item.key);
    if (!restored || hash(Buffer.from(await restored.arrayBuffer())) !== item.sha256) throw new Error('Restored object checksum failed');
  }
  return manifest;
}
