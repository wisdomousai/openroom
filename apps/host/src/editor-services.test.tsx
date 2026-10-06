/**
 * The cloud adapter resolves the editor's destinations to the host's routes:
 * the deck editor's back arrow and Share, and the full-session Plans link.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { DeckEditorTopBar, useEditorServices, type DraftStatus } from '@openroom/editor';

import { CloudEditorServices, routeFor } from './editor-services';
import { to } from './destinations';

// A browser window without the desktop shell.
beforeAll(() => { vi.stubGlobal('window', {}); });
afterAll(() => { vi.unstubAllGlobals(); });

const rootRoute = createRootRoute();
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/space/$spaceId' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/space/$spaceId/members' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings/billing' }),
  ]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <RouterContextProvider router={router as never}>
      <CloudEditorServices>{node}</CloudEditorServices>
    </RouterContextProvider>,
  );
}

const IDLE: DraftStatus = { state: 'idle', label: '', retrying: false, savedAt: null };

function PlansLink() {
  const { Link } = useEditorServices().navigation;
  return <Link to={{ kind: 'plans' }}>Plans</Link>;
}

function topBar(): string {
  return render(
    <DeckEditorTopBar
      title="Summer camp — day 1"
      folderName="Workshops"
      libraryTo={{ kind: 'library', place: { spaceId: 's1', folderId: 'f1', itemId: 'd1' } }}
      shareTo={{ kind: 'spaceMembers', spaceId: 's1' }}
      status={IDLE}
      onPresent={() => undefined}
      canPresent
      onStart={() => undefined}
      starting={false}
      canStart
      error={null}
    />,
  );
}

describe('cloud editor services', () => {
  it('takes the back arrow to the deck’s own row in the Library', () => {
    // The selection rides in the URL, so Back from the editor lands on the deck.
    expect(topBar()).toContain('/space/s1?folderId=f1&amp;itemId=d1');
  });

  it('sends Share to the space members', () => {
    expect(topBar()).toContain('href="/space/s1/members"');
  });

  it('links Plans to billing', () => {
    expect(render(<PlansLink />)).toContain('href="/settings/billing"');
  });

  it('maps live destinations to the session routes', () => {
    expect(routeFor({ kind: 'sessionRemote', sessionCode: 'ABCD1234' })).toEqual(to.sessionRemote('ABCD1234'));
    expect(routeFor({ kind: 'sessionNotes', sessionId: 's9' })).toEqual(to.sessionNotes('s9'));
    expect(routeFor({ kind: 'library' })).toEqual(to.library());
  });
});
