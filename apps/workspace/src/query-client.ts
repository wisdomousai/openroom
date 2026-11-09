import { QueryClient } from '@tanstack/react-query';
import { ApiError, onUnauthorized } from './api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // A 4xx is the worker's answer, not a hiccup: asking again gets the same one.
      retry: (failures, error) =>
        failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/*
 * A 401 from any workspace call means the cookie may be gone. Ask /api/me
 * again; the sign-in gate follows that answer, so an expired sign-in reaches
 * the sign-in page from every screen, the Library included.
 */
onUnauthorized(() => {
  void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
});

const MANAGEMENT_QUERY_ROOTS = new Set([
  'students',
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
