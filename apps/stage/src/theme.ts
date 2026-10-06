/**
 * Theme plumbing. The stage owns no colours of its own: every pixel is painted
 * from an `@openroom/ui` token, applied to `<html>` from the snapshot's `theme`
 * so a host's live `session.theme` switch restyles the projector mid-sentence.
 */
import { useEffect, useState } from 'react';
import { applyTheme, resolveTheme, type ThemeId, type ThemeMode } from '@openroom/ui';

/**
 * Light or dark. The stage has no user-facing toggle — a projector is not a
 * device anyone configures — so it follows `prefers-color-scheme`, with a
 * `?mode=light|dark` query override for the (common) case of a laptop set to
 * dark driving a beamer that would rather be light.
 */
export function modeFromQuery(search: string, systemDark: boolean): ThemeMode {
  const pinned = new URLSearchParams(search).get('mode');
  if (pinned === 'dark') return 'dark';
  if (pinned === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function useThemeMode(): ThemeMode {
  const read = (): ThemeMode =>
    modeFromQuery(
      typeof location === 'undefined' ? '' : location.search,
      typeof matchMedia === 'function' ? matchMedia(DARK_QUERY).matches : false,
    );
  const [mode, setMode] = useState<ThemeMode>(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = (): void => setMode(read());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mode;
}

/**
 * Applies the snapshot's theme and returns the resolved id (ambient needs it).
 *
 * - `target` omitted → theme `<html>` (standalone /stage/).
 * - `target === null` → wait (embedded root not mounted yet).
 * - `target` element → theme that node (LiveHost embed).
 */
export function useAppliedTheme(
  themeId: string | undefined | null,
  mode: ThemeMode,
  target?: HTMLElement | null,
): ThemeId {
  const resolved = resolveTheme(themeId);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (target === null) return;
    applyTheme(target ?? document.documentElement, resolved, mode);
  }, [resolved, mode, target]);
  return resolved;
}

/** Read a token off the document, e.g. `token('--chart-1')`. Empty when unset. */
export function token(name: string, el?: Element | null): string {
  if (typeof getComputedStyle !== 'function') return '';
  const target = el ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return '';
  return getComputedStyle(target).getPropertyValue(name).trim();
}

/** The five categorical chart tokens, in order. Every visualization uses these. */
export const CHART_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

/**
 * A choice interaction may carry up to 10 options but the token system defines
 * exactly five categorical colours (each contrast-checked against the
 * background). The sixth to tenth series therefore reuse the palette darkened
 * *towards the foreground* — which can only increase contrast against the
 * background, never decrease it, so the accessibility floor survives.
 */
export function chartColor(index: number): string {
  const base = CHART_VARS[index % CHART_VARS.length] as string;
  const cycle = Math.floor(index / CHART_VARS.length);
  if (cycle === 0) return base;
  return `color-mix(in oklab, ${base} ${Math.max(45, 100 - cycle * 28)}%, var(--foreground))`;
}
