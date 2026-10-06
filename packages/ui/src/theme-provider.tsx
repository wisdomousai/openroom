/**
 * Theme plumbing for the console.
 *
 * Tokens, themes and the DOM write all come from `@openroom/ui` verbatim
 * (docs/CONTRACTS.md §UI theming) — this module only decides *which* theme and
 * mode are live and keeps the console's own preference in localStorage.
 *
 * Two sources of truth, in priority order:
 *   1. `sessionTheme` — the `theme` field on the host snapshot. While a session is
 *      open, the console shows exactly what the stage and the participants see.
 *   2. the local preference — used on the setup screen and as the value the
 *      picker starts from.
 */
import * as React from 'react';
import {
  applyTheme,
  resolveTheme,
  THEME_LIST,
  themeToCssVars,
  type ThemeId,
  type ThemeMode,
} from './index.js';

export type ModeSetting = ThemeMode | 'system';

const THEME_KEY = 'openroom.host.theme';
const MODE_KEY = 'openroom.host.themeMode';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — preference just does not persist */
  }
}

export function loadThemeId(): ThemeId {
  return resolveTheme(safeGet(THEME_KEY));
}

export function loadModeSetting(): ModeSetting {
  const raw = safeGet(MODE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function prefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Collapse the tri-state setting to the mode `applyTheme` actually needs. */
export function resolveMode(setting: ModeSetting, systemDark: boolean): ThemeMode {
  if (setting === 'system') return systemDark ? 'dark' : 'light';
  return setting;
}

/**
 * Paint the stored preference on <html> before React mounts, so the first
 * frame is already themed (no white flash on a chalkboard console).
 */
export function bootstrapTheme(): void {
  if (typeof document === 'undefined') return;
  const setting = loadModeSetting();
  applyTheme(document.documentElement, loadThemeId(), resolveMode(setting, prefersDark()));
}

export interface ThemeContextValue {
  /** The console's own stored preference. */
  preferredThemeId: ThemeId;
  /** The session's theme when a session is open, else null. */
  sessionThemeId: ThemeId | null;
  /** What is actually painted right now. */
  activeThemeId: ThemeId;
  modeSetting: ModeSetting;
  mode: ThemeMode;
  setPreferredThemeId: (id: ThemeId) => void;
  setModeSetting: (mode: ModeSetting) => void;
  /** Called by the console on every snapshot; null clears the session override. */
  setSessionThemeId: (id: string | null | undefined) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preferredThemeId, setPreferred] = React.useState<ThemeId>(loadThemeId);
  const [sessionThemeId, setRoom] = React.useState<ThemeId | null>(null);
  const [modeSetting, setMode] = React.useState<ModeSetting>(loadModeSetting);
  const [systemDark, setSystemDark] = React.useState<boolean>(prefersDark);

  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const activeThemeId = sessionThemeId ?? preferredThemeId;
  const mode = resolveMode(modeSetting, systemDark);

  React.useLayoutEffect(() => {
    applyTheme(document.documentElement, activeThemeId, mode);
  }, [activeThemeId, mode]);

  const setPreferredThemeId = React.useCallback((id: ThemeId) => {
    setPreferred(id);
    safeSet(THEME_KEY, id);
  }, []);

  const setModeSetting = React.useCallback((next: ModeSetting) => {
    setMode(next);
    safeSet(MODE_KEY, next);
  }, []);

  const setSessionThemeId = React.useCallback((id: string | null | undefined) => {
    setRoom(id === null || id === undefined ? null : resolveTheme(id));
  }, []);

  const value: ThemeContextValue = React.useMemo(
    () => ({
      preferredThemeId,
      sessionThemeId,
      activeThemeId,
      modeSetting,
      mode,
      setPreferredThemeId,
      setModeSetting,
      setSessionThemeId,
    }),
    [
      preferredThemeId,
      sessionThemeId,
      activeThemeId,
      modeSetting,
      mode,
      setPreferredThemeId,
      setModeSetting,
      setSessionThemeId,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** The five themes, ready for the picker. */
export const THEME_CHOICES = THEME_LIST;

/**
 * The colours a swatch row shows for a theme in a given mode. Read straight
 * out of the token table so a preview can never drift from the real thing.
 */
export function swatchColors(themeId: ThemeId, mode: ThemeMode): string[] {
  const vars = themeToCssVars(themeId, mode);
  return ['--background', '--primary', '--chart-1', '--chart-2', '--chart-3', '--chart-4'].map(
    (key) => vars[key] ?? '#000000',
  );
}

/** Inline style object that renders a preview *in* another theme's tokens. */
export function previewStyle(themeId: ThemeId, mode: ThemeMode): React.CSSProperties {
  return themeToCssVars(themeId, mode) as React.CSSProperties;
}
