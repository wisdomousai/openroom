import {
  parseOpenRoomFile,
  stringifyOpenRoomFile,
  validateOutline,
  type OpenRoomFileV1,
  type Outline,
} from '@openroom/schema';

export type HandoffApi = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown }>;

export type DeckHandoffResult =
  | { kind: 'sign-in' }
  | { kind: 'open-path'; path: string }
  | { kind: 'open-source'; displayName: string; source: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function filename(title: string): string {
  const stem = title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'deck';
  return `${stem}.openroom`;
}

export async function prepareDesktopDeckHandoff(input: {
  origin: string;
  deckId: string;
  api: HandoffApi;
  device: { id: string; name: string };
  readPath(path: string): Promise<string>;
  randomId(): string;
}): Promise<DeckHandoffResult> {
  const deckPath = `/api/decks/${encodeURIComponent(input.deckId)}`;
  let fileLink = await input.api('GET', `${deckPath}/file-link`);
  if (fileLink.status === 401) return { kind: 'sign-in' };
  if (fileLink.status !== 200) throw new Error('Could not read this deck’s Desktop link.');
  let linkBody = record(fileLink.body);
  const locations = Array.isArray(linkBody['locations']) ? linkBody['locations'] : [];
  const local = locations.map(record).find((location) => location['deviceId'] === input.device.id);
  if (typeof local?.['path'] === 'string' && local['path'] !== '') {
    const source = await input.readPath(local['path']).catch(() => null);
    if (source !== null) {
      const parsed = parseOpenRoomFile(source);
      if (
        parsed.ok
        && parsed.file.remote?.deckId === input.deckId
        && new URL(parsed.file.remote.origin).origin === input.origin
      ) return { kind: 'open-path', path: local['path'] };
    }
  }

  const detailResponse = await input.api('GET', deckPath);
  if (detailResponse.status === 401) return { kind: 'sign-in' };
  if (detailResponse.status !== 200) throw new Error('This deck could not be opened.');
  const detail = record(detailResponse.body);
  const deck = record(detail['deck']);
  const parsedOutline = validateOutline(detail['content']);
  if (!parsedOutline.ok) throw new Error('This deck has no valid saved content yet.');
  const contentHash = detail['contentHash'];
  const currentVersion = deck['currentVersion'];
  if (typeof contentHash !== 'string' || typeof currentVersion !== 'number') {
    throw new Error('This deck has no saved version to open.');
  }

  let fileId = typeof linkBody['fileId'] === 'string' ? linkBody['fileId'] : null;
  if (fileId === null) {
    const candidate = input.randomId();
    const linked = await input.api('POST', `${deckPath}/file-link`, { fileId: candidate });
    if (linked.status === 401) return { kind: 'sign-in' };
    if (linked.status === 201 || linked.status === 200) {
      fileId = candidate;
    } else if (linked.status === 409) {
      // Another client may have linked the deck between our GET and POST.
      fileLink = await input.api('GET', `${deckPath}/file-link`);
      linkBody = record(fileLink.body);
      fileId = typeof linkBody['fileId'] === 'string' ? linkBody['fileId'] : null;
    }
    if (fileId === null) throw new Error('Could not link this deck to a Desktop file.');
  }

  const title = typeof deck['title'] === 'string' && deck['title'] !== ''
    ? deck['title']
    : parsedOutline.outline.meta.title;
  const outline = parsedOutline.outline as Outline;
  const document: OpenRoomFileV1 = {
    format: 'openroom-file',
    fileVersion: 1,
    fileId,
    localRevision: 0,
    remote: {
      origin: `${input.origin}/`,
      deckId: input.deckId,
      baseVersion: currentVersion,
      baseContentHash: contentHash,
      baseOutline: outline,
    },
    outline,
  };
  return { kind: 'open-source', displayName: filename(title), source: stringifyOpenRoomFile(document) };
}
