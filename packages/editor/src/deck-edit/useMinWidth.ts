import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the window is at least `px` wide, following resizes. Without
 * `matchMedia` (tests, server render) it answers true: the desktop layout.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof matchMedia !== 'function') return () => {};
    const list = matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia !== 'function' || matchMedia(query).matches,
    () => true,
  );
}
