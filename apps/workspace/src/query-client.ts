import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

const MANAGEMENT_QUERY_ROOTS = new Set([
  'contexts',
  'dashboard',
  'decks',
  'spaces',
  'sessions',
  'trash',
]);

/** Keep collection, detail, linked-work, Explorer, Home, and Trash views coherent. */
export function invalidateManagementData(): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => MANAGEMENT_QUERY_ROOTS.has(String(query.queryKey[0])),
  });
}
