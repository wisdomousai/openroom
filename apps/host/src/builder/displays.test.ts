import { describe, expect, it } from 'vitest';
import { DISPLAY_OPTION_KEYS_FOR, DISPLAY_STYLES as SCHEMA_DISPLAY_STYLES } from '@openroom/schema';

import {
  BUILDER_ADD_TYPES,
  DISPLAY_LABELS,
  DISPLAY_STYLES,
  INTERACTION_TYPES,
  OPTION_KEYS_FOR,
  defaultOptionsFor,
  fieldsForDisplay,
} from './displays';

/**
 * `displays.ts` is a mirror of the schema's own tables. A chart the builder
 * cannot configure is a chart whose options an author can only reach by editing
 * YAML, so the two tables have to agree key-for-key rather than roughly.
 */
describe('builder display catalog mirrors @openroom/schema', () => {
  it('lists the same charts per interaction type', () => {
    expect(DISPLAY_STYLES).toEqual(SCHEMA_DISPLAY_STYLES);
  });

  it('allows the same option keys per chart', () => {
    const schemaKeys = Object.fromEntries(
      Object.entries(DISPLAY_OPTION_KEYS_FOR).map(([display, keys]) => [display, [...keys]]),
    );
    const builderKeys = Object.fromEntries(
      Object.entries(OPTION_KEYS_FOR).map(([display, keys]) => [display, [...keys]]),
    );
    expect(builderKeys).toEqual(schemaKeys);
  });

  it('defaults and field metadata exist for every chart, and only for its own keys', () => {
    for (const display of Object.keys(DISPLAY_OPTION_KEYS_FOR)) {
      const allowed = new Set(OPTION_KEYS_FOR[display] ?? []);
      for (const key of Object.keys(defaultOptionsFor(display))) {
        expect(allowed.has(key as never), `${display}.${key}`).toBe(true);
      }
      expect(fieldsForDisplay(display).every((field) => field !== undefined), display).toBe(true);
      expect(DISPLAY_LABELS[display], display).toBeDefined();
    }
  });

  it('offers every interaction type the schema knows in the type pickers', () => {
    const types = Object.keys(SCHEMA_DISPLAY_STYLES).sort();
    expect(INTERACTION_TYPES.map((t) => t.value).sort()).toEqual(types);
    // The add menu adds one non-type entry: word cloud is a text interaction
    // with a different chart, not an interaction type of its own.
    expect(BUILDER_ADD_TYPES.map((t) => t.value).sort()).toEqual([...types, 'word-cloud'].sort());
  });
});
