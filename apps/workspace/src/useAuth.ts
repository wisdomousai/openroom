import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  fetchAuthStatus,
  fetchMe,
  type AuthStatus,
  type MeUser,
} from './api';

/**
 * Every state the sign-in gate can show. `unreachable` means the account check
 * failed (a 5xx answer or no answer at all); it is never shown as signed out.
 */
export type AuthState =
  | { status: 'checking' }
  | { status: 'signed-in'; user: MeUser }
  | { status: 'signed-out'; methods: AuthStatus }
  | { status: 'unreachable' };

export interface AuthSession {
  state: AuthState;
  /** The signed-in user; null in every other state. */
  user: MeUser | null;
  /** Ask again after a failed account check. */
  retry: () => void;
  /** true while a check is in flight, so Try again is not pressed twice. */
  retrying: boolean;
  /** Re-read /api/me after a sign-in or a billing change; rethrows a failed check. */
  refresh: () => Promise<void>;
  clear: () => void;
}

/**
 * The last answer wins. A failed check shows `unreachable` only when there is
 * no earlier answer: a background recheck that fails keeps the person where
 * they were, and a 401 from a request reaches signed out through the
 * invalidated /api/me.
 */
export function authState(
  me: { data: MeUser | null | undefined; isError: boolean },
  methods: { data: AuthStatus | undefined; isError: boolean },
): AuthState {
  if (me.data === undefined) return me.isError ? { status: 'unreachable' } : { status: 'checking' };
  if (me.data !== null) return { status: 'signed-in', user: me.data };
  if (methods.data !== undefined) return { status: 'signed-out', methods: methods.data };
  return methods.isError ? { status: 'unreachable' } : { status: 'checking' };
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
 * can offer Google and/or the demo account picker. A request refused with 401
 * invalidates `/api/me` (query-client.ts), and the gate follows its answer.
 */
export function useAuth(): AuthSession {
  const queryClient = useQueryClient();
  const meQuery = useQuery(authQueryOptions);
  const me: MeUser | null | undefined = meQuery.data;
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const methodsQuery = useQuery({
    ...authStatusQueryOptions,
    enabled: me === null,
  });
  const state = authState(meQuery, methodsQuery);

  useEffect(() => {
    if (me === undefined) return;

    const identity = me?.id ?? null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) {
      clearUserScopedQueries(queryClient);
    }
    previousIdentity.current = identity;
  }, [queryClient, me]);

  const { refetch: refetchMe } = meQuery;
  const { refetch: refetchMethods } = methodsQuery;
  const retry = useCallback(() => {
    void (me === undefined ? refetchMe() : refetchMethods());
  }, [me, refetchMe, refetchMethods]);

  const refresh = useCallback(async () => {
    // Fetch outside the cache so an account switch can clear user-scoped data
    // before React observes the new identity with old space query results.
    // A failed check throws here and leaves the gate as it was.
    const previous = queryClient.getQueryData<MeUser | null>(authQueryOptions.queryKey);
    const next = await fetchMe();
    if ((previous?.id ?? null) !== (next?.id ?? null)) {
      clearUserScopedQueries(queryClient);
    }
    previousIdentity.current = next?.id ?? null;
    queryClient.setQueryData(authQueryOptions.queryKey, next);
    if (next === null) {
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

  return {
    state,
    user: state.status === 'signed-in' ? state.user : null,
    retry,
    retrying: meQuery.isFetching || methodsQuery.isFetching,
    refresh,
    clear,
  };
}
