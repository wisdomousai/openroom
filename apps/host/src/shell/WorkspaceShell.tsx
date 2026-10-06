import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';

import { getSessionItem, listAllSpaces, listContexts, listDecks, type ContextSummary } from '../api';
import { EXPERIENCES } from './experiences';
import { SpaceSwitcher } from './SpaceSwitcher';
import { PersonBadge } from '../components/PersonBadge';
import { ThemeStudio } from '../components/ThemeStudio';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { initials } from '../lib/initials';
import { groupSpaces } from '../lib/members';
import { cn } from '../lib/utils';
import { to } from '../destinations';
import { useAuth } from '../useAuth';

interface Props {
  children: ReactNode;
  signedIn?: boolean;
  /** Optional right-side header actions */
  actions?: ReactNode;
}

function searchString(search: unknown): Record<string, unknown> {
  return search !== null && typeof search === 'object' ? (search as Record<string, unknown>) : {};
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A person is a folder: their decks are the space filtered to them. */
function personTo(context: ContextSummary) {
  return to.library({ spaceId: context.spaceId, contextId: context.id });
}

/**
 * 244 chrome rail: New deck, Library, Students, Shared, Trash.
 *
 * People are folders. There is no Contexts / People peer nav item.
 */
export function WorkspaceShell({ children, signedIn, actions }: Props) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const rawSearch = useRouterState({ select: (state) => state.location.search });
  const search = searchString(rawSearch);
  const activeContextId = asId(search.contextId);
  const activeFolderId = asId(search.folderId);
  const pathSpaceId = pathname.startsWith('/space/') && pathname !== '/space/new'
    ? decodeURIComponent(pathname.slice('/space/'.length).split('/')[0] ?? '')
    : null;

  const navigate = useNavigate();
  const session = useAuth();
  const user = session.user ?? null;
  const [query, setQuery] = useState('');

  const spacesQuery = useQuery({
    queryKey: ['spaces', 'all'] as const,
    queryFn: listAllSpaces,
    enabled: signedIn === true,
  });
  const contextsQuery = useQuery({
    queryKey: ['contexts', 'all'] as const,
    queryFn: () => listContexts(),
    enabled: signedIn === true,
  });
  const decksQuery = useQuery({
    queryKey: ['decks', 'all'] as const,
    queryFn: () => listDecks(),
    enabled: signedIn === true,
  });

  const spaces = spacesQuery.data ?? [];
  const { mine: ownedSpaces, shared: invitedSpaces } = groupSpaces(spaces);
  const personal = ownedSpaces[0] ?? null;
  const contexts = contextsQuery.data ?? [];
  const decks = decksQuery.data ?? [];
  const pathContextId = /^\/tutor\/contexts\/([^/]+)/.exec(pathname)?.[1];
  const pathSessionId = /^\/sessions\/([^/]+)\/record$/.exec(pathname)?.[1];
  const sessionQuery = useQuery({
    queryKey: ['sessions', pathSessionId, 'workspace'],
    queryFn: () => getSessionItem(pathSessionId!),
    enabled: signedIn === true && Boolean(pathSessionId),
  });
  const activeSpaceId = pathSpaceId
    ?? asId(search.sourceSpaceId) ?? asId(search.spaceId)
    ?? contexts.find((context) => context.id === pathContextId)?.spaceId
    ?? sessionQuery.data?.session.spaceId ?? null;
  const currentSpace = spaces.find((space) => space.id === activeSpaceId) ?? personal;
  const experience = currentSpace?.settings.experience ?? 'classroom';
  const profile = EXPERIENCES[experience];
  const mine = ownedSpaces.filter((space) => space.settings.experience === experience);
  const shared = invitedSpaces.filter((space) => space.settings.experience === experience);
  const visibleContexts = contexts.filter((context) => spaces.some((space) => space.id === context.spaceId && space.settings.experience === experience));

  const countByContext = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deck of decks) {
      if (!deck.contextId) continue;
      counts.set(deck.contextId, (counts.get(deck.contextId) ?? 0) + 1);
    }
    return counts;
  }, [decks]);

  const countBySpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deck of decks) {
      counts.set(deck.spaceId, (counts.get(deck.spaceId) ?? 0) + 1);
    }
    return counts;
  }, [decks]);

  const newDeckTo = useMemo(() => {
    if (activeContextId) {
      const context = contexts.find((row) => row.id === activeContextId);
      return to.deckNew({
        contextId: activeContextId,
        spaceId: activeSpaceId ?? context?.spaceId,
        folderId: activeFolderId,
      });
    }
    if (activeSpaceId) {
      return to.deckNew({ spaceId: activeSpaceId, folderId: activeFolderId });
    }
    if (currentSpace) return to.deckNew({ spaceId: currentSpace.id });
    return to.deckNew();
  }, [activeContextId, activeFolderId, activeSpaceId, contexts, currentSpace]);

  const libraryTo = currentSpace ? to.library({ spaceId: currentSpace.id }) : to.library();
  const libraryPath = pathname === '/space' || (pathname !== '/space/new' && /^\/space\/[^/]+$/.test(pathname));
  const libraryActive = libraryPath && activeContextId === null;
  const flushMain = libraryPath;
  const accountPage = pathname === '/settings' || pathname.startsWith('/settings/');

  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? decks.filter((deck) => deck.title.toLocaleLowerCase().includes(needle)) : [];
  }, [decks, query]);
  const runSearch = (event: FormEvent) => { event.preventDefault(); setSearchOpen(true); };

  const userLabel = user?.name || user?.email || 'You';

  return (
    <div data-workspace-experience={experience} className={cn("flex h-svh flex-col overflow-hidden bg-background text-foreground", accountPage ? "min-w-0" : "min-w-[980px]")}>
      <header className="flex h-11 shrink-0 items-center gap-3.5 bg-chrome px-3.5">
        <Link {...libraryTo} className="shrink-0 text-title-bar tracking-tight">
          OpenRoom
        </Link>
        <form onSubmit={runSearch} className={cn("relative min-w-0", accountPage && "hidden lg:block")} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
          <Input
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setSearchOpen(true); }}
            onFocus={() => { if (query) setSearchOpen(true); }}
            onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }}
            placeholder="Search decks"
            aria-label="Search decks"
            className="h-7 w-[300px] max-w-[40vw] rounded-full bg-card"
          />
          {searchOpen && query.trim() ? <div className="absolute left-0 top-9 z-50 max-h-80 w-[400px] overflow-auto rounded-md border bg-popover p-1 shadow-lg" aria-label="Search results">
            {searchResults.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No matching decks</p> : searchResults.map((deck) => <Link
              key={deck.id} {...to.library({ spaceId: deck.spaceId, folderId: deck.folderId, itemId: deck.id })}
              onClick={() => setSearchOpen(false)} className="block rounded p-2 hover:bg-accent focus:bg-accent">
              <span className="block text-sm">{deck.title}</span>
              <span className="block text-xs text-muted-foreground">{spaces.find((space) => space.id === deck.spaceId)?.name ?? 'Workspace'}</span>
            </Link>)}
          </div> : null}
        </form>
        <span className="flex-1" />
        {actions}
        <div className={accountPage ? "hidden sm:block" : undefined}><ThemeStudio /></div>
        <Button asChild variant="subtle" size="sm" className="h-7 px-2.5 font-normal">
          <Link {...to.settings(currentSpace?.id)}>Settings</Link>
        </Button>
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--chart-5)] text-[12px] font-semibold text-primary-foreground"
        >
          {initials(userLabel)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cn("min-h-0 w-[244px] shrink-0 flex-col border-r border-border bg-chrome", accountPage ? "hidden md:flex" : "flex")}>
          <div className="px-2 pt-2"><SpaceSwitcher current={currentSpace} spaces={spaces} /></div>
          <div className="px-3 pb-2 pt-3">
            <Button asChild className="h-[34px] w-full">
              <Link {...newDeckTo}>New deck</Link>
            </Button>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3" aria-label="Workspace">
            <Link
              {...libraryTo}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-secondary',
                libraryActive ? 'bg-desk font-semibold' : 'hover:bg-desk',
              )}
              aria-current={libraryActive ? 'page' : undefined}
            >
              <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              Library
            </Link>

            {mine.filter((space) => space.id !== currentSpace?.id && !visibleContexts.some((context) => context.spaceId === space.id)).map((space) => <Link key={space.id} {...to.library({ spaceId: space.id })}
              className={cn('flex h-8 items-center rounded-md px-2 pl-8 text-secondary hover:bg-desk', activeSpaceId === space.id && !activeContextId && 'bg-desk font-semibold')}>{space.name}</Link>)}

            {profile.contextLabel ? <><p className="mb-1 mt-3.5 px-2 text-caption text-muted-foreground">{profile.contextLabel}</p>
            {visibleContexts.map((person) => {
              const active = activeContextId === person.id;
              const count = countByContext.get(person.id) ?? 0;
              return (
                <Link
                  key={person.id}
                  {...personTo(person)}
                  className={cn(
                    'flex h-[34px] items-center gap-2.5 rounded-md px-2 text-secondary',
                    active ? 'bg-desk font-semibold' : 'hover:bg-desk',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <PersonBadge name={person.displayName} id={person.id} />
                  <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{count}</span>
                </Link>
              );
            })}
            <Link
              {...to.studentNew(currentSpace?.id, experience === 'classroom' ? 'classroom' : 'tutoring')}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-rail font-normal text-muted-foreground hover:bg-desk hover:text-primary"
            >
              <span aria-hidden="true" className="w-[22px] text-center text-title-bar font-normal">
                ＋
              </span>
              {profile.addContextLabel}
            </Link></> : null}

            {shared.length > 0 ? (
              <>
                <p className="mb-1 mt-4 px-2 text-caption text-muted-foreground">Shared</p>
                {shared.map((space) => {
                  const active =
                    activeContextId === null && activeSpaceId === space.id;
                  return (
                    <Link
                      key={space.id}
                      {...to.library({ spaceId: space.id })}
                      className={cn(
                        'flex h-[34px] items-center gap-2.5 rounded-md px-2 text-secondary',
                        active ? 'bg-desk font-semibold' : 'hover:bg-desk',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <PersonBadge name={space.name} id={space.id} />
                      <span className="min-w-0 flex-1 truncate">{space.name}</span>
                      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                        {countBySpace.get(space.id) ?? 0}
                      </span>
                    </Link>
                  );
                })}
              </>
            ) : (
              <p className="mb-1 mt-4 px-2 text-caption text-muted-foreground">Shared</p>
            )}

            <span className="min-h-4 flex-1" />

            <Link
              {...to.trash(currentSpace?.id)}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-secondary text-muted-foreground hover:bg-desk',
                pathname === '/tutor/trash' && 'bg-desk font-semibold text-foreground',
              )}
              aria-current={pathname === '/tutor/trash' ? 'page' : undefined}
            >
              <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
              Trash
            </Link>
          </nav>
        </aside>

        <main
          key={pathname}
          className={cn(
            'min-h-0 min-w-0 flex-1',
            flushMain ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-4 lg:p-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
