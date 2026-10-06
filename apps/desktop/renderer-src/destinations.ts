/**
 * Where the editor's destinations live when Desktop's core renderer hosts it.
 *
 * The file and present windows are this bundle (`/core/index.html`). Every
 * other destination — Library, session console, remote, Q&A desk, recap,
 * Notes, plans — is a page of the workspace bundle (`/host/index.html`), which
 * a core-only build does not ship. `workspaceAvailable()` answers which build
 * this is; without the workspace those destinations are not offered.
 */
import type { EditorDestination } from '@openroom/editor';

/** The core renderer's own entry: the file window. */
export const DECK_DOCUMENT_HREF = '/core/index.html#/file';

/** The workspace bundle's entry, copied in by `copy-workspace.mjs`. */
export const WORKSPACE_ENTRY = '/host/index.html';

type WorkspaceDestination = Exclude<EditorDestination, { kind: 'deckDocument' }>;

const segment = encodeURIComponent;

/** The workspace hash route for a destination (apps/workspace/src/destinations.ts). */
export function workspaceRoute(destination: WorkspaceDestination): string {
  switch (destination.kind) {
    case 'library': {
      const place = destination.place;
      if (!place?.spaceId) return '/space';
      const search = new URLSearchParams();
      if (place.folderId) search.set('folderId', place.folderId);
      if (place.itemId) search.set('itemId', place.itemId);
      if (place.contextId) search.set('contextId', place.contextId);
      const query = search.toString();
      return `/space/${segment(place.spaceId)}${query === '' ? '' : `?${query}`}`;
    }
    case 'spaceMembers':
      return `/space/${segment(destination.spaceId)}/members`;
    case 'sessionConsole':
      return `/sessions/${segment(destination.sessionCode)}`;
    case 'sessionRemote':
      return `/sessions/${segment(destination.sessionCode)}/remote`;
    case 'sessionQna':
      return `/sessions/${segment(destination.sessionCode)}/qna`;
    case 'sessionRecap':
      return `/sessions/${segment(destination.sessionCode)}/recap`;
    case 'sessionNotes':
      return `/sessions/${segment(destination.sessionId)}/record`;
    case 'plans':
      return '/settings/billing';
  }
}

/** The URL a destination opens at; null when this build has no workspace to open it in. */
export function destinationHref(destination: EditorDestination, workspace: boolean): string | null {
  if (destination.kind === 'deckDocument') return DECK_DOCUMENT_HREF;
  return workspace ? `${WORKSPACE_ENTRY}#${workspaceRoute(destination)}` : null;
}

/**
 * An absolute link to the workspace's remote or Q&A desk page, handed to
 * another device. The token sits in the hash, which never goes on the wire.
 */
export function workspaceShareUrl(
  surface: 'remote' | 'qna',
  sessionCode: string,
  hostToken: string,
  origin: string,
): string {
  return `${origin}${WORKSPACE_ENTRY}#/sessions/${segment(sessionCode)}/${surface}?token=${segment(hostToken)}`;
}

let workspace: boolean | null = null;

/** Whether this build ships the workspace bundle. Asked once, before the first render. */
export async function probeWorkspace(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(WORKSPACE_ENTRY, { method: 'HEAD' });
    workspace = response.ok;
  } catch {
    workspace = false;
  }
  return workspace;
}

/** The answer `probeWorkspace` found; false before it ran. */
export function workspaceAvailable(): boolean {
  return workspace === true;
}
