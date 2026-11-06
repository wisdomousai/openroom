import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

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
