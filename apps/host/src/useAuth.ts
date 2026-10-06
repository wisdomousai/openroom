import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  fetchAuthStatus,
  fetchMe,
  type AuthStatus,
  type MeUser,
} from './api';

export interface AuthSession {
  /** undefined while the first /api/me is in flight, null when signed out. */
  user: MeUser | null | undefined;
  /**
   * true when any sign-in method is available (Google OAuth and/or demo
   * accounts).
   */
  canSignIn: boolean;
  /** Full status once probed; null while the first probe is in flight. */
  authStatus: AuthStatus | null;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const authQueryOptions = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: fetchMe,
  staleTime: 30_000,
});

export const authStatusQueryOptions = queryOptions({
  queryKey: ['session', 'auth-status'] as const,
  queryFn: fetchAuthStatus,
  staleTime: 5 * 60_000,
});

/**
 * Removing the live 'auth' query would orphan its subscribed observers: the
 * gate keeps rendering the removed query's last data and never sees the
 * setQueryData that follows, so sign-in and sign-out only take effect after a
 * full reload. Spare both auth roots; drop everything user-scoped.
 */
function clearUserScopedQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'session' && query.queryKey[0] !== 'auth',
  });
}

/**
 * One `/api/me` on load. When signed out, probe `/api/auth/status` so the UI
 * can offer Google and/or the demo account picker.
 */
export function useAuth(): AuthSession {
  const queryClient = useQueryClient();
  const meQuery = useQuery(authQueryOptions);
  const user: MeUser | null | undefined = meQuery.data;
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const authQuery = useQuery({
    ...authStatusQueryOptions,
    enabled: user === null,
  });
  const authStatus: AuthStatus | null = authQuery.data ?? null;

  useEffect(() => {
    if (user === undefined) return;

    const identity = user?.id ?? null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) {
      clearUserScopedQueries(queryClient);
    }
    previousIdentity.current = identity;
  }, [queryClient, user]);

  const refresh = useCallback(async () => {
    // Fetch outside the cache so an account switch can clear user-scoped data
    // before React observes the new identity with old space query results.
    const previous = queryClient.getQueryData<MeUser | null>(authQueryOptions.queryKey);
    const me = await fetchMe();
    if ((previous?.id ?? null) !== (me?.id ?? null)) {
      clearUserScopedQueries(queryClient);
    }
    previousIdentity.current = me?.id ?? null;
    queryClient.setQueryData(authQueryOptions.queryKey, me);
    if (me === null) {
      await queryClient.fetchQuery({
        ...authStatusQueryOptions,
        staleTime: 0,
      });
    }
  }, [queryClient]);

  const clear = useCallback(() => {
    clearUserScopedQueries(queryClient);
    previousIdentity.current = null;
    queryClient.setQueryData(authQueryOptions.queryKey, null);
    void queryClient.invalidateQueries({ queryKey: authStatusQueryOptions.queryKey });
  }, [queryClient]);

  const canSignIn = authStatus !== null && (authStatus.google || authStatus.demo);

  return { user, canSignIn, authStatus, refresh, clear };
}
