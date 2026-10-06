import type { PresentationPosition } from '@openroom/schema';
import {
  createDeck,
  createSession,
  addDeckVersion,
  launchSession,
  startCreatedSession,
  type SpaceTreeDeck,
} from '../api';
import { currentCloudDocument } from './cloud-document';
import { renameDeck, questionReadinessMessage, type StoredSession } from '@openroom/editor';

/**
 * The two verbs the library owns that no single API wrapper covers.
 *
 * Both are compositions of existing exports — `api.ts` is not the place to grow
 * a "library" vocabulary, and a screen-level verb that happens to need two
 * requests is still one verb to the teacher.
 */

export interface Place {
  spaceId: string | null;
  folderId: string | null;
}

/**
 * Start teaching a deck, now.
 *
 * A deck is a file: opening it live is one gesture, so this creates the
 * session and launches it in the same call rather than parking the teacher on
 * a scheduling form. Requires a stamped version — a version-0 deck has nothing
 * to put on the stage, which is why the ladder offers Open instead.
 */
export async function startSessionFromDeck(
  deck: Pick<SpaceTreeDeck, 'id' | 'title' | 'contextId' | 'currentVersion'>,
  place: Place,
  cursor?: PresentationPosition,
): Promise<StoredSession> {
  if (!cursor) {
    const { detail, outline } = await currentCloudDocument(deck.id);
    const issue = questionReadinessMessage(outline);
    if (issue) throw new Error(issue);
    const saved = await addDeckVersion(deck.id, outline, detail.deck.currentVersion);
    deck = { ...detail.deck, title: outline.meta.title, currentVersion: saved.version };
  }
  const session = await createSession({
    deckId: deck.id,
    deckVersion: deck.currentVersion,
    title: deck.title,
    ...(deck.contextId ? { contextId: deck.contextId } : {}),
    spaceId: place.spaceId,
    folderId: place.folderId,
  });
  const launched = await launchSession(session.id, { start: true, version: deck.currentVersion, cursor });
  if (launched.started === false) await startCreatedSession(launched.sessionCode, launched.hostToken, cursor);
  return {
    sessionCode: launched.sessionCode,
    code: launched.code,
    hostToken: launched.hostToken,
    stageToken: launched.stageToken,
    title: deck.title,
    ...(launched.joinUrl ? { joinUrl: launched.joinUrl } : {}),
    createdAt: Date.now(),
  };
}

/** The name a copy gets. “(copy)” once, not “(copy) (copy)”. */
export function copyName(title: string): string {
  return title.endsWith(' (copy)') ? title : `${title} (copy)`;
}

/**
 * Duplicate a deck, content and all, into the same folder.
 *
 * `createDeck` accepts the outline directly, so the copy arrives written
 * rather than as an empty shell the teacher has to prepare again.
 */
export async function duplicateDeck(
  deck: Pick<SpaceTreeDeck, 'id' | 'title' | 'contextId' | 'shape' | 'folderId'>,
  place: Place,
): Promise<{ id: string; title: string }> {
  const { outline } = await currentCloudDocument(deck.id);
  const title = copyName(outline.meta.title);
  const created = await createDeck({
    title,
    ...(deck.contextId ? { contextId: deck.contextId } : {}),
    content: renameDeck(outline, title),
    spaceId: place.spaceId,
    folderId: deck.folderId,
  });
  return { id: created.deck.id, title: created.deck.title };
}
