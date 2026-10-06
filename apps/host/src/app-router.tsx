import { BrandKitPage, BrandKitsPage } from './pages/BrandKitPages';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, type ReactNode } from 'react';

import { to, type LinkTarget } from './destinations';

import { LiveHost } from './LiveHost';
import { PresenterRemote } from './PresenterRemote';
import { QnaDesk } from './QnaDesk';
import { LearnerPage } from './pages/LearnerPage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { DesktopFileEditor } from './pages/DesktopFileEditor';
import { DesktopPresentationPage } from './pages/DesktopPresentationPage';
import { SpaceEditPage } from './pages/SpaceEditPage';
import { SpaceNewPage } from './pages/SpaceNewPage';
import { SpaceInvitePage, SpaceMemberEditPage, SpaceMembersPage } from './pages/SpaceMemberPages';
import { SpacePage } from './pages/SpacePage';
import { BillingPage } from './pages/BillingPage';
import { ApiTokenNewPage, SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import {
  ContextDetailPage,
  ContextEditPage,
  ContextNewPage,
  ContextsPage,
} from './pages/tutor/Contexts';
import { ContextLinkNewPage } from './pages/tutor/ContextLinks';
import { LearnerWorkPage, LearnerWorkReviewPage } from './pages/tutor/LearnerWork';
import { DeckNewPage } from './pages/tutor/Decks';
import { SessionNotesPage } from './pages/tutor/SessionNotes';
import { TutoringTrashPage } from './pages/tutor/Trash';
import { WorkspaceShell } from './shell/WorkspaceShell';
import { loadLiveSession, saveLiveSession } from './storage';
import { ToastRegion, useToasts } from './toasts';
import type { StoredSession } from './types';
import { useAuth, type AuthSession } from './useAuth';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';

type Notify = (message: string, tone?: 'info' | 'error') => void;

interface AppServices {
  session: AuthSession;
  notify: Notify;
  openSession: (live: StoredSession) => void;
  /** Leaving a live surface lands in the Library — the one home for library work. */
  exitToLibrary: () => void;
}

const AppServicesContext = createContext<AppServices | null>(null);
const TanStackDevelopmentTools = import.meta.env.DEV
  ? lazy(() => import('./components/TanStackDevelopmentTools'))
  : null;
const LessonExamplesPage = lazy(() => import('./pages/LessonExamplesPage'));
const SessionRecapPage = lazy(() => import('./pages/SessionRecapPage').then((module) => ({ default: module.SessionRecapPage })));
const SavedResultsPage = lazy(() => import('./pages/SavedResultsPage').then((module) => ({ default: module.SavedResultsPage })));

function useAppServices(): AppServices {
  const value = useContext(AppServicesContext);
  if (!value) throw new Error('App services are only available inside the host router.');
  return value;
}

function RootLayout() {
  const session = useAuth();
  const { toasts, push } = useToasts();
  const navigate = useNavigate();

  const openSession = useCallback((live: StoredSession) => {
    saveLiveSession(live);
    void navigate(to.sessionConsole(live.sessionCode));
  }, [navigate]);

  const exitToLibrary = useCallback(() => {
    void navigate(to.library());
  }, [navigate]);

  return (
    <AppServicesContext.Provider value={{ session, notify: push, openSession, exitToLibrary }}>
      <Outlet />
      <ToastRegion toasts={toasts} />
      {TanStackDevelopmentTools ? <Suspense fallback={null}><TanStackDevelopmentTools /></Suspense> : null}
    </AppServicesContext.Provider>
  );
}

/**
 * The signed-in gate, shared by the workspace shell and by the full-bleed
 * routes that opt out of it. A route that owns the viewport still needs an
 * account; it just does not need a sidebar.
 */
function SignedInGate({ children }: { children: ReactNode }) {
  const { session } = useAppServices();
  if (session.user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <p className="text-sm text-muted-foreground">Checking your account…</p>
      </div>
    );
  }
  if (session.user === null) return <SignInPage session={session} />;
  return <>{children}</>;
}

function WorkspaceLayout() {
  return (
    <SignedInGate>
      <WorkspaceShell signedIn>
        <Outlet />
      </WorkspaceShell>
    </SignedInGate>
  );
}

function resolveLiveSession(sessionCode: string, token: string | null): StoredSession | null {
  let live = loadLiveSession(sessionCode);
  if (!live && token) {
    live = { sessionCode, code: sessionCode, hostToken: token, stageToken: '', createdAt: Date.now() };
    saveLiveSession(live);
  }
  return live;
}

/**
 * No credentials on this device. This one exit goes Home rather than to the
 * Library: Home is where Rejoin lives, and rejoining is what is wanted here.
 */
function MissingSession({ sessionCode }: { sessionCode: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="font-display text-xl font-semibold">OpenRoom</h1>
      <Alert variant="destructive">
        <AlertTitle>No credentials for session {sessionCode} on this device.</AlertTitle>
        <AlertDescription className="mt-1">
          Sign in and open the session from Home, or append the host token:{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">#/sessions/{sessionCode}?token=HOST_TOKEN</code>
        </AlertDescription>
      </Alert>
      <div><Button asChild><Link {...to.home()}>Home</Link></Button></div>
    </div>
  );
}

function optionalStringSearch(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== 'null' && value !== 'undefined'
    ? value
    : undefined;
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <h1 className="font-display text-xl font-semibold">Page not found</h1>
      <Link className="underline" {...to.home()}>Home</Link>
    </main>
  ),
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_workspace',
  validateSearch: (search: Record<string, unknown>): { spaceId?: string } => ({ spaceId: optionalStringSearch(search.spaceId) }),
  component: WorkspaceLayout,
});

function LibraryHomeScreen() {
  const { session, openSession, notify } = useAppServices();
  return <SpacePage session={session} spaceId={null} onOpenSession={openSession} notify={notify} />;
}

const libraryHomeRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/', component: LibraryHomeScreen });

const spaceRootRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space',
  component: () => {
    const { session, openSession, notify } = useAppServices();
    return <SpacePage session={session} spaceId={null} folderId={null} onOpenSession={openSession} notify={notify} />;
  },
});

const spaceRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId',
  // Both optional so callers that only set a folder need not clear `itemId`.
  validateSearch: (search: Record<string, unknown>): { folderId?: string; itemId?: string; contextId?: string } => ({
    folderId: optionalStringSearch(search.folderId),
    itemId: optionalStringSearch(search.itemId),
    contextId: optionalStringSearch(search.contextId),
  }),
  component: SpaceScreen,
});

function SpaceScreen() {
  const { spaceId } = spaceRoute.useParams();
  const { folderId, itemId, contextId } = spaceRoute.useSearch();
  const { session, openSession, notify } = useAppServices();
  return <SpacePage session={session} spaceId={spaceId} folderId={folderId} itemId={itemId} contextId={contextId} onOpenSession={openSession} notify={notify} />;
}

/*
 * Settings are a route, not a drawer: `/:id/edit` is where an edit lives
 * everywhere else in this workspace, and a space is no exception.
 */
const spaceEditRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId/edit',
  component: () => <SpaceEditPage spaceId={spaceEditRoute.useParams().spaceId} />,
});

const brandKitsRoute = createRoute({
  getParentRoute: () => workspaceRoute, path: '/space/$spaceId/brand-kits',
  validateSearch: (search: Record<string, unknown>): { trashed?: boolean } => ({ trashed: search.trashed === true || search.trashed === 'true' ? true : undefined }),
  component: () => <BrandKitsPage spaceId={brandKitsRoute.useParams().spaceId} trashed={brandKitsRoute.useSearch().trashed} />,
});
const brandKitNewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/space/$spaceId/brand-kits/new', component: () => <BrandKitPage spaceId={brandKitNewRoute.useParams().spaceId} editing /> });
const brandKitRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/space/$spaceId/brand-kits/$kitId', component: () => <BrandKitPage {...brandKitRoute.useParams()} /> });
const brandKitEditRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/space/$spaceId/brand-kits/$kitId/edit', component: () => <BrandKitPage {...brandKitEditRoute.useParams()} editing /> });

const lessonExamplesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId/samples',
  validateSearch: (search: Record<string, unknown>): { folderId?: string; contextId?: string } => ({
    folderId: optionalStringSearch(search.folderId), contextId: optionalStringSearch(search.contextId),
  }),
  component: () => {
    const { spaceId } = lessonExamplesRoute.useParams();
    const { folderId, contextId } = lessonExamplesRoute.useSearch();
    return <Suspense fallback={<p role="status">Loading lessons…</p>}><LessonExamplesPage spaceId={spaceId} folderId={folderId ?? null} contextId={contextId ?? null} /></Suspense>;
  },
});

const spaceMembersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId/members',
  component: () => <SpaceMembersPage spaceId={spaceMembersRoute.useParams().spaceId} />,
});

const spaceInviteRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId/members/invite',
  component: () => <SpaceInvitePage spaceId={spaceInviteRoute.useParams().spaceId} />,
});

const spaceMemberEditRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/space/$spaceId/members/$userId/edit',
  component: () => {
    const { spaceId, userId } = spaceMemberEditRoute.useParams();
    return <SpaceMemberEditPage spaceId={spaceId} userId={userId} />;
  },
});

const contextsRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/tutor/contexts', component: ContextsPage });
const contextNewRoute = createRoute({
  getParentRoute: () => workspaceRoute, path: '/tutor/contexts/new',
  validateSearch: (search: Record<string, unknown>): { sourceSpaceId?: string; experience?: 'tutoring' | 'classroom' } => ({
    sourceSpaceId: optionalStringSearch(search.sourceSpaceId),
    experience: search.experience === 'classroom' ? 'classroom' as const : 'tutoring' as const,
  }),
  component: () => <ContextNewPage {...contextNewRoute.useSearch()} />,
});
const spaceNewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/space/new', component: SpaceNewPage });
const contextDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/tutor/contexts/$contextId',
  component: () => <ContextDetailPage contextId={contextDetailRoute.useParams().contextId} />,
});
const contextEditRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/tutor/contexts/$contextId/edit', component: () => <ContextEditPage contextId={contextEditRoute.useParams().contextId} /> });
const learnerWorkRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/tutor/contexts/$contextId/work', component: () => <LearnerWorkPage contextId={learnerWorkRoute.useParams().contextId} /> });
const learnerWorkReviewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/tutor/contexts/$contextId/work/$submissionId/edit', component: () => <LearnerWorkReviewPage {...learnerWorkReviewRoute.useParams()} /> });
const contextLinkNewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/tutor/contexts/$contextId/links/new',
  component: () => <ContextLinkNewPage contextId={contextLinkNewRoute.useParams().contextId} />,
});

const deckNewSearch = (search: Record<string, unknown>) => ({
  contextId: optionalStringSearch(search.contextId),
  spaceId: optionalStringSearch(search.spaceId),
  folderId: optionalStringSearch(search.folderId),
});

const deckNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks/new',
  validateSearch: deckNewSearch,
  component: () => {
    const { contextId, spaceId, folderId } = deckNewRoute.useSearch();
    return <SignedInGate><DeckNewPage contextId={contextId ?? null} spaceId={spaceId ?? null} folderId={folderId ?? null} /></SignedInGate>;
  },
});

/**
 * The deck editor owns the viewport. It hangs off the root rather than the
 * workspace so no sidebar, max-width or page padding sits between the outline
 * and the edge of the screen — the same arrangement the live console uses. The
 * sign-in gate the workspace would have applied is applied here instead.
 */
function DeckEditorScreen({ deckId }: { deckId: string }) {
  const { openSession } = useAppServices();
  return (
    <SignedInGate>
      <DeckEditorPage deckId={deckId} onOpenSession={openSession} />
    </SignedInGate>
  );
}

const deckEditRoute = createRoute({ getParentRoute: () => rootRoute, path: '/decks/$deckId/edit', component: () => <DeckEditorScreen deckId={deckEditRoute.useParams().deckId} /> });
const savedResultsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/results/$archiveId', component: () => {
  const { archiveId } = savedResultsRoute.useParams(), { session } = useAppServices();
  return <SignedInGate><Suspense fallback={<p className="p-6">Loading saved results…</p>}><SavedResultsPage key={`${session.user?.id}:${archiveId}`} userId={session.user?.id ?? ''} archiveId={archiveId} /></Suspense></SignedInGate>;
} });

const desktopFileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/desktop/file', component: DesktopFileEditor });
const desktopPresentationRoute = createRoute({ getParentRoute: () => rootRoute, path: '/desktop/present', component: DesktopPresentationPage });

/**
 * Sessions have no collection route: a session is started, never scheduled, and
 * Home owns the cross-cutting history. Its remaining teacher surface after the
 * hour is Notes.
 */
const sessionRecordRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/sessions/$sessionKey/record', component: () => <SessionNotesPage sessionId={sessionRecordRoute.useParams().sessionKey} /> });

function TrashScreen() {
  const { notify } = useAppServices();
  return <TutoringTrashPage notify={notify} />;
}

const trashRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/tutor/trash', component: TrashScreen });

const settingsRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/settings', component: () => <SettingsPage session={useAppServices().session} /> });
const billingRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/settings/billing', component: () => { const { session } = useAppServices(); return <BillingPage key={session.user?.id ?? 'guest'} session={session} />; } });
const settingsTokenNewRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/settings/tokens/new', component: ApiTokenNewPage });

function liveSearch(search: Record<string, unknown>) {
  return { token: optionalStringSearch(search.token) };
}

/**
 * The student's page hangs off the root, not the workspace: it must never see
 * `WorkspaceLayout`'s sign-in gate, because a link holder has no account to
 * sign into and being asked for one is the wrong answer.
 */
const learnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/learn',
  validateSearch: (search: Record<string, unknown>) => ({ token: optionalStringSearch(search.token) }),
  component: () => <LearnerPage token={learnRoute.useSearch().token ?? null} />,
});

const liveSessionRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionCode', validateSearch: liveSearch, component: LiveSessionScreen });
const liveRemoteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionCode/remote', validateSearch: liveSearch, component: RemoteScreen });
const liveQnaRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionCode/qna', validateSearch: liveSearch, component: QnaScreen });
const liveRecapRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionCode/recap', validateSearch: liveSearch, component: RecapScreen });


/**
 * Resolve the session this device is holding, and take the token back out of
 * the address bar.
 *
 * A host token arriving in `?token=` is a credential, not a location: it is
 * persisted once and then stripped (replace, so Back does not reinstate it).
 * Every internal hop between console, remote and Q&A desk travels token-less —
 * this device already has the credentials.
 */
function useResolvedSession(
  route: typeof liveSessionRoute | typeof liveRemoteRoute | typeof liveQnaRoute | typeof liveRecapRoute,
  target: (sessionCode: string) => LinkTarget,
) {
  const { sessionCode } = route.useParams();
  const { token } = route.useSearch();
  const navigate = useNavigate();
  const live = resolveLiveSession(sessionCode, token ?? null);
  const resolved = live !== null;
  useEffect(() => {
    if (token === undefined || !resolved) return;
    void navigate({ ...target(sessionCode), replace: true });
  }, [navigate, resolved, sessionCode, target, token]);
  return { sessionCode, live };
}

function LiveSessionScreen() {
  const { sessionCode, live } = useResolvedSession(liveSessionRoute, to.sessionConsole);
  const { exitToLibrary } = useAppServices();
  return live ? <LiveHost live={live} onLeave={exitToLibrary} /> : <MissingSession sessionCode={sessionCode} />;
}

function RemoteScreen() {
  const { sessionCode, live } = useResolvedSession(liveRemoteRoute, to.sessionRemote);
  const { exitToLibrary } = useAppServices();
  const navigate = useNavigate();
  if (!live) return <MissingSession sessionCode={sessionCode} />;
  return <PresenterRemote live={live} onLeave={exitToLibrary} onOpenLiveHost={() => void navigate(to.sessionConsole(sessionCode))} />;
}

function QnaScreen() {
  const { sessionCode, live } = useResolvedSession(liveQnaRoute, to.sessionQna);
  const { exitToLibrary } = useAppServices();
  return live ? <QnaDesk live={live} onLeave={exitToLibrary} /> : <MissingSession sessionCode={sessionCode} />;
}

function RecapScreen() {
  const { sessionCode, live } = useResolvedSession(liveRecapRoute, to.sessionRecap);
  return live ? <Suspense fallback={<p className="p-6">Loading recap…</p>}><SessionRecapPage key={sessionCode} live={live} /></Suspense> : <MissingSession sessionCode={sessionCode} />;
}

const routeTree = rootRoute.addChildren([
  workspaceRoute.addChildren([
    libraryHomeRoute,
    spaceRootRoute,
    spaceRoute,
    spaceNewRoute,
    spaceEditRoute,
    brandKitsRoute, brandKitNewRoute, brandKitRoute, brandKitEditRoute,
    lessonExamplesRoute,
    spaceMembersRoute,
    spaceInviteRoute,
    spaceMemberEditRoute,
    contextsRoute,
    contextNewRoute,
    contextDetailRoute,
    contextEditRoute,
    learnerWorkRoute,
    learnerWorkReviewRoute,
    contextLinkNewRoute,
    sessionRecordRoute,
    trashRoute,
    settingsRoute,
    billingRoute,
    settingsTokenNewRoute,
  ]),
  deckNewRoute,
  deckEditRoute,
  savedResultsRoute,
  desktopFileRoute,
  desktopPresentationRoute,
  learnRoute,
  liveSessionRoute,
  liveRemoteRoute,
  liveQnaRoute,
  liveRecapRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
