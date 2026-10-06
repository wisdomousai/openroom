/**
 * The participant app paints itself from `@openroom/ui` tokens only.
 *
 * The session's theme arrives on every snapshot, so a host switching `session.theme`
 * mid-session restyles the phones in the same revision as the projector. Light
 * or dark follows `prefers-color-scheme`: a participant is holding their own
 * device with their own preference, and the app has no business arguing with it
 * (and no space for a toggle).
 */
import { useEffect, useState } from 'react';
import { applyTheme, resolveTheme, type ThemeMode } from '@openroom/ui';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function pickMode(systemDark: boolean): ThemeMode {
  return systemDark ? 'dark' : 'light';
}

export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() =>
    pickMode(typeof matchMedia === 'function' ? matchMedia(DARK_QUERY).matches : false),
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = (): void => setMode(pickMode(mq.matches));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mode;
}

/**
 * Apply the snapshot's theme to `<html>`. An unknown or missing id resolves to
 * `default`, so a snapshot from a newer server can never leave the app unstyled.
 */
export function useSessionTheme(themeId: string | undefined | null): void {
  const mode = useThemeMode();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyTheme(document.documentElement, resolveTheme(themeId), mode);
  }, [themeId, mode]);
}
