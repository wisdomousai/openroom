import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';

import { getSessionItem, getSpaceTree, listAllSpaces, listStudents, listDecks, type StudentSummary } from '../api';
import { EXPERIENCES } from './experiences';
import { SpaceSwitcher } from './SpaceSwitcher';
import { PersonBadge } from '../components/PersonBadge';
import { ThemeStudio } from '@openroom/ui/theme-studio';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { initials } from '../lib/initials';
import { groupSpaces, navigableSpaces } from '../lib/members';
import { cn } from '@openroom/ui/utils';
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
function personTo(student: StudentSummary) {
  return to.library({ spaceId: student.spaceId, studentId: student.id });
}

/**
 * 244 chrome rail: New deck, Library, Students, Shared, Trash.
 *
 * People are folders. There is no Students / People peer nav item.
 */
export function WorkspaceShell({ children, signedIn, actions }: Props) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const rawSearch = useRouterState({ select: (state) => state.location.search });
  const search = searchString(rawSearch);
  const activeStudentId = asId(search.studentId);
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
  const studentsQuery = useQuery({
    queryKey: ['students', 'all'] as const,
    queryFn: () => listStudents(),
    enabled: signedIn === true,
  });
  const trashedStudentsQuery = useQuery({
    queryKey: ['students', 'trashed'] as const,
    queryFn: () => listStudents({ trash: true }),
    enabled: signedIn === true,
  });
  const decksQuery = useQuery({
    queryKey: ['decks', 'all'] as const,
    queryFn: () => listDecks(),
    enabled: signedIn === true,
  });

  const allSpaces = spacesQuery.data ?? [];
  // A trashed student's own space keeps resolving as the current space, but the nav does not list it.
  const spaces = navigableSpaces(allSpaces, { trashed: trashedStudentsQuery.data, live: studentsQuery.data, decks: decksQuery.data });
  const { mine: ownedSpaces, shared: invitedSpaces } = groupSpaces(spaces);
  const personal = ownedSpaces[0] ?? null;
  const students = studentsQuery.data ?? [];
  const decks = decksQuery.data ?? [];
  const pathStudentId = /^\/tutor\/students\/([^/]+)/.exec(pathname)?.[1];
  const pathSessionId = /^\/sessions\/([^/]+)\/record$/.exec(pathname)?.[1];
  const sessionQuery = useQuery({
    queryKey: ['sessions', pathSessionId, 'workspace'],
    queryFn: () => getSessionItem(pathSessionId!),
    enabled: signedIn === true && Boolean(pathSessionId),
  });
  const activeSpaceId = pathSpaceId
    ?? asId(search.sourceSpaceId) ?? asId(search.spaceId)
    ?? students.find((student) => student.id === pathStudentId)?.spaceId
    ?? sessionQuery.data?.session.spaceId ?? null;
  const currentSpace = allSpaces.find((space) => space.id === activeSpaceId) ?? personal;
  const experience = currentSpace?.settings.experience ?? 'classroom';
  const profile = EXPERIENCES[experience];
  const mine = ownedSpaces.filter((space) => space.settings.experience === experience);
  const shared = invitedSpaces.filter((space) => space.settings.experience === experience);
  const visibleStudents = students.filter((student) => spaces.some((space) => space.id === student.spaceId && space.settings.experience === experience));

  const countByStudent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deck of decks) {
      if (!deck.studentId) continue;
      counts.set(deck.studentId, (counts.get(deck.studentId) ?? 0) + 1);
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
    // A student in Trash takes no new decks; the button files into the first own space instead.
    if (trashedStudentsQuery.data?.some((row) => row.id === activeStudentId || (row.spaceId === activeSpaceId && row.spaceId.startsWith('sp_ctx_')))) {
      return personal ? to.deckNew({ spaceId: personal.id }) : to.deckNew();
    }
    if (activeStudentId) {
      const student = students.find((row) => row.id === activeStudentId);
      return to.deckNew({
        studentId: activeStudentId,
        spaceId: activeSpaceId ?? student?.spaceId,
        folderId: activeFolderId,
      });
    }
    if (activeSpaceId) {
      return to.deckNew({ spaceId: activeSpaceId, folderId: activeFolderId });
    }
    if (currentSpace) return to.deckNew({ spaceId: currentSpace.id });
    return to.deckNew();
  }, [activeStudentId, activeFolderId, activeSpaceId, students, currentSpace, personal, trashedStudentsQuery.data]);

  const libraryTo = currentSpace ? to.library({ spaceId: currentSpace.id }) : to.library();
  const libraryPath = pathname === '/space' || (pathname !== '/space/new' && /^\/space\/[^/]+$/.test(pathname));
  const libraryActive = libraryPath && activeStudentId === null;
  const flushMain = libraryPath;
  /*
   * Form and Notes pages fit any window, as Settings does: Add student, Space
   * settings, Sample lessons, a session's Notes and Review learner work. The
   * Library and the rest keep the 980 px desktop minimum, with a notice below it.
   */
  const responsivePage = pathname === '/settings' || pathname.startsWith('/settings/')
    || pathname === '/tutor/students/new'
    || /^\/space\/[^/]+\/(edit|samples)$/.test(pathname)
    || /^\/sessions\/[^/]+\/record$/.test(pathname)
    || /^\/tutor\/students\/[^/]+\/work(\/[^/]+\/edit)?$/.test(pathname);

  const [searchOpen, setSearchOpen] = useState(false);
  const studentById = useMemo(() => new Map([...(trashedStudentsQuery.data ?? []), ...students].map((student) => [student.id, student])), [students, trashedStudentsQuery.data]);
  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? decks.filter((deck) => deck.title.toLocaleLowerCase().includes(needle)) : [];
  }, [decks, query]);
  /*
   * A deck filed in a folder that is in Trash shows at its space root, so the
   * link takes the folder the space tree shows (the Library's own query and
   * cache). Until that tree arrives the stored folder stands in.
   */
  const resultSpaceIds = useMemo(() => [...new Set(searchResults.map((deck) => deck.spaceId))], [searchResults]);
  const resultTrees = useQueries({
    queries: resultSpaceIds.map((spaceId) => ({
      queryKey: ['spaces', spaceId, 'tree', 'all'] as const,
      queryFn: () => getSpaceTree(spaceId),
      enabled: signedIn === true && searchOpen,
    })),
  });
  const shownFolderId = (deck: { id: string; spaceId: string; folderId: string | null }): string | null => {
    const tree = resultTrees[resultSpaceIds.indexOf(deck.spaceId)]?.data;
    const shown = tree?.decks?.find((row) => row.id === deck.id);
    return shown ? shown.folderId ?? null : deck.folderId;
  };
  const runSearch = (event: FormEvent) => { event.preventDefault(); setSearchOpen(true); };

  const userLabel = user?.name || user?.email || 'You';

  return (
    <div data-workspace-experience={experience} className={cn("flex h-svh flex-col overflow-hidden bg-background text-foreground", responsivePage ? "min-w-0" : "min-w-[980px]")}>
      {responsivePage ? null : (
        <p role="note" className="sticky left-0 w-screen shrink-0 border-b border-border bg-card px-3.5 py-1.5 text-caption text-muted-foreground min-[980px]:hidden">
          This page is made for windows at least 980 px wide. Widen the window to see all of it.
        </p>
      )}
      <header className="flex h-11 shrink-0 items-center gap-3.5 bg-chrome px-3.5">
        <Link {...libraryTo} className="shrink-0 text-title-bar tracking-tight">
          OpenRoom
        </Link>
        <form onSubmit={runSearch} className={cn("relative min-w-0", responsivePage && "hidden lg:block")} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
          <Input
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setSearchOpen(true); }}
            onFocus={() => { if (query) setSearchOpen(true); }}
            onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }}
            placeholder="Search decks"
            aria-label="Search decks"
            className="h-7 w-[300px] max-w-[40vw] rounded-full bg-card"
          />
          {searchOpen && query.trim() ? <div className="absolute left-0 top-9 z-50 max-h-80 w-[400px] overflow-auto rounded-md border border-border bg-popover p-1 shadow-[var(--shadow-overlay)]" aria-label="Search results">
            {searchResults.length === 0 ? <p className="p-3 text-secondary text-muted-foreground">No decks match</p> : searchResults.map((deck) => {
              // A student's deck opens in that student's place, as the sidebar link does; a trashed student's place shows Restore.
              const person = deck.studentId ? studentById.get(deck.studentId) : undefined;
              return <Link
                key={deck.id} {...to.library({ spaceId: deck.spaceId, folderId: shownFolderId(deck), itemId: deck.id, studentId: person?.id })}
                onClick={() => { setSearchOpen(false); setQuery(''); }} className="block rounded p-2 hover:bg-accent focus:bg-accent">
                <span className="block text-secondary">{deck.title}</span>
                <span className="block text-caption text-muted-foreground">{person ? (person.deletedAt != null ? `${person.displayName} · in Trash` : person.displayName) : allSpaces.find((space) => space.id === deck.spaceId)?.name ?? 'Workspace'}</span>
              </Link>;
            })}
          </div> : null}
        </form>
        <span className="flex-1" />
        {actions}
        <div className={responsivePage ? "hidden sm:block" : undefined}><ThemeStudio /></div>
        <Button asChild variant="subtle" size="sm" className="h-7 px-2.5 font-normal">
          <a href="/docs/start/" target="_blank" rel="noreferrer">Manual<span className="sr-only"> (opens in a new tab)</span></a>
        </Button>
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
        <aside className={cn("min-h-0 w-[244px] shrink-0 flex-col border-r border-border bg-chrome", responsivePage ? "hidden md:flex" : "flex")}>
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

            {mine.filter((space) => space.id !== currentSpace?.id && !visibleStudents.some((student) => student.spaceId === space.id)).map((space) => <Link key={space.id} {...to.library({ spaceId: space.id })}
              className={cn('flex h-8 items-center rounded-md px-2 pl-8 text-secondary hover:bg-desk', activeSpaceId === space.id && !activeStudentId && 'bg-desk font-semibold')}>{space.name}</Link>)}

            {profile.studentLabel ? <><p className="mb-1 mt-3.5 px-2 text-caption text-muted-foreground">{profile.studentLabel}</p>
            {visibleStudents.map((person) => {
              const active = activeStudentId === person.id;
              const count = countByStudent.get(person.id) ?? 0;
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
              {profile.addStudentLabel}
            </Link></> : null}

            {shared.length > 0 ? (
              <>
                <p className="mb-1 mt-4 px-2 text-caption text-muted-foreground">Shared</p>
                {shared.map((space) => {
                  const active =
                    activeStudentId === null && activeSpaceId === space.id;
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
            ) : null}

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
