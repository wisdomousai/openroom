import { parseOutline, stringifyOpenRoomFile, type Outline, type OpenRoomFileV1 } from '@openroom/schema';
import { addDeckVersion, getDeck, getDeckDraft, getDeckFileLink, linkDeckFile } from '../api';
import { downloadDeckFile, renameDeck } from '@openroom/editor';
import { portableDeck } from './portable-deck';

/** Read acknowledged draft content; a failed read must never silently export an older deck. */
export async function currentCloudDocument(deckId: string) {
  const [detail, draft] = await Promise.all([getDeck(deckId), getDeckDraft(deckId)]);
  if (draft.baseVersion !== detail.deck.currentVersion) throw new Error('This deck has conflicting edits. Open it to resolve them first.');
  const parsed = parseOutline(draft.source, 'yaml');
  if (!parsed.ok) throw new Error('Open the deck and repair its content before continuing.');
  const outline: Outline = parsed.outline;
  return { detail, outline };
}

export async function renameCloudDocument(deckId: string, title: string) {
  const { detail, outline } = await currentCloudDocument(deckId);
  return addDeckVersion(deckId, renameDeck(outline, title), detail.deck.currentVersion);
}

export async function downloadCloudDocument(deckId: string, current?: { outline: Outline; baseVersion: number }) {
  const loaded = current ? null : await currentCloudDocument(deckId);
  const outline = current?.outline ?? loaded!.outline;
  const portable = await portableDeck(outline, window.location.origin);
  const saved = await addDeckVersion(deckId, outline, current?.baseVersion ?? loaded!.detail.deck.currentVersion);
  const existing = await getDeckFileLink(deckId);
  const fileId = existing.fileId ?? crypto.randomUUID();
  if (existing.fileId === null) await linkDeckFile(deckId, fileId);
  const document: OpenRoomFileV1 = {
    format: 'openroom-file', fileVersion: 1, fileId, localRevision: 0,
    remote: { origin: `${window.location.origin}/`, deckId, baseVersion: saved.version, baseContentHash: saved.contentHash, baseOutline: outline },
    outline: portable.outline,
    resources: portable.resources,
  };
  downloadDeckFile(stringifyOpenRoomFile(document), outline.meta.title, portable.entries);
  return saved;
}
