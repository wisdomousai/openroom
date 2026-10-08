import { stringify as stringifyYaml } from 'yaml';

import { defaultDeckDesign } from './deck-design.js';
import type { Outline } from './outline-types.js';

/** The same initial document in cloud folders and local files. */
export function blankDeck(title = 'Untitled'): Outline {
  return { version: 1, meta: { title, objectives: [] }, design: defaultDeckDesign(),
    steps: [{ id: 'slide-1', kind: 'blank', elements: [] }], interactions: [] };
}

/**
 * Editor text for a stamped outline. The server's draft zero and the editor's
 * reload both use it, so an untouched deck reads the same everywhere.
 */
export function deckSource(outline: Outline): string {
  return stringifyYaml(outline, { lineWidth: 100 });
}
