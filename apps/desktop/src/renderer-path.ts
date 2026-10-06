import { resolve, sep } from 'node:path';

/**
 * The bundles the main process serves from renderer/ at `openroom://app/<bundle>/`:
 * the core renderer (file and presentation windows) and, when the build ships
 * it, the workspace bundle.
 */
export const RENDERER_BUNDLES = ['core', 'host'] as const;

/**
 * The file a renderer URL names, or null when it falls outside a bundle root.
 * Anything else under renderer/, and every path that escapes it, is refused.
 */
export function safeRendererPath(rendererRoot: string, pathname: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const root = resolve(rendererRoot);
  const resolved = resolve(root, relative);
  return RENDERER_BUNDLES.some((bundle) => resolved.startsWith(`${resolve(root, bundle)}${sep}`)) ? resolved : null;
}
