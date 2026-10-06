import { Link } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listSavedResults, type ResultsScope } from '../api/saved-results';
import { to } from '../destinations';
import { useAuth } from '../useAuth';
import { Button } from '@openroom/ui/components/button';

/** Result files belong to their deck, alongside its Notes; they are not a session directory. */
export function SavedResultsLinks({ compact = false, ...scope }: ResultsScope & { compact?: boolean }) {
  const { user } = useAuth();
  const [captureDeadline] = useState(() => Date.now() + 5000);
  const query = useInfiniteQuery({
    queryKey: ['saved-results', user?.id, scope],
    queryFn: ({ pageParam, signal }) => listSavedResults(scope, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!user && !!(scope.deckId || scope.sessionId || scope.sessionCode),
    retry: false,
    gcTime: 0,
    refetchInterval: (state) => compact && Date.now() < captureDeadline && state.state.data?.pages[0]?.archives.length === 0 ? 1000 : false,
  });
  if (!user || query.isPending) return null;
  if (query.isError) return <div className={compact ? '' : 'border-t border-hairline px-4 py-3'}><p className="text-caption text-muted-foreground">Saved results could not be loaded.</p><Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Retry saved results</Button></div>;
  const files = query.data.pages.flatMap((page) => page.archives);
  if (!files.length) return null;
  if (compact) return <Button asChild variant="outline" size="sm"><Link {...to.savedResults(files[0]!.id)}>Saved results</Link></Button>;
  const titles = new Map<string, number>();
  return <section aria-label="Saved results" className="flex flex-col gap-0.5 border-t border-hairline px-2.5 py-3">
    <h3 className="mb-1.5 px-2 text-caption font-normal text-muted-foreground">Saved results</h3>
    {files.map((file) => {
      const ordinal = (titles.get(file.title) ?? 0) + 1; titles.set(file.title, ordinal);
      return <Link key={file.id} {...to.savedResults(file.id)} className="rounded-md px-2 py-2 text-[13px] hover:bg-chrome">
        <span className="block truncate">{file.title}{ordinal > 1 ? ` · ${ordinal}` : ''}</span>
        <span className="block text-caption text-muted-foreground">{file.hasIndividualResponses ? 'Summary · individual responses' : 'Summary'}</span>
      </Link>;
    })}
    {query.hasNextPage ? <Button variant="ghost" size="sm" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'More result files'}</Button> : null}
  </section>;
}
