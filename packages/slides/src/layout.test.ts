import { LAYOUTS_FOR_KIND as SCHEMA_LAYOUTS_FOR_KIND, OUTLINE_LAYOUTS, layoutForMediaPlace } from '@openroom/schema';
import { describe, expect, it } from 'vitest';

import {
  LAYOUTS_FOR_KIND,
  SLIDE_LAYOUTS,
  defaultLayoutForKind,
  effectiveLayout,
  layoutAllowedForKind,
  type SlideStepKind,
} from './layout';

/**
 * `layout.ts` mirrors the schema's table so the projector bundle does not have
 * to pull the schema package in to draw a slide. These are the tests that stop
 * the mirror drifting: they are the whole reason the duplication is allowed.
 */
describe('the mirrored layout tables agree with @openroom/schema', () => {
  it('carries the same layout vocabulary', () => {
    expect([...SLIDE_LAYOUTS]).toEqual([...OUTLINE_LAYOUTS]);
  });

  it('carries the same kinds', () => {
    expect(Object.keys(LAYOUTS_FOR_KIND).sort()).toEqual(
      Object.keys(SCHEMA_LAYOUTS_FOR_KIND).sort(),
    );
  });

  it('allows the same layouts per kind, in the same order', () => {
    // Order matters here in a way it does not in the schema: entry zero is the
    // layout a step is drawn in when the author named none.
    for (const [kind, layouts] of Object.entries(LAYOUTS_FOR_KIND)) {
      expect([kind, [...layouts]]).toEqual([
        kind,
        [...SCHEMA_LAYOUTS_FOR_KIND[kind as SlideStepKind]],
      ]);
    }
  });
});

const KINDS = Object.keys(LAYOUTS_FOR_KIND) as SlideStepKind[];

describe('effectiveLayout', () => {
  it('falls back to the kind default when the step names none', () => {
    for (const kind of KINDS) {
      expect(effectiveLayout({ kind })).toBe(defaultLayoutForKind(kind));
      expect(LAYOUTS_FOR_KIND[kind][0]).toBe(defaultLayoutForKind(kind));
    }
  });

  it('honours every layout the kind is allowed to claim', () => {
    for (const kind of KINDS) {
      for (const layout of LAYOUTS_FOR_KIND[kind]) {
        expect(effectiveLayout({ kind, layout })).toBe(layout);
      }
    }
  });

  it('falls back rather than drawing a region the kind cannot fill', () => {
    // A term has no aggregate region, so `poll` would produce an empty slide
    // rather than a wrong one. the deck editor's validator flags it; the renderer still
    // has to draw something the session can read.
    expect(layoutAllowedForKind('term', 'poll')).toBe(false);
    expect(effectiveLayout({ kind: 'term', layout: 'poll' })).toBe('title');
    expect(effectiveLayout({ kind: 'cards', layout: 'timer' })).toBe('grid');
  });
});

describe('a picture placed beside the words', () => {
  const STACKED = new Set(['title', 'text', 'grid']);

  it('draws a stacked layout as split, the layout the deck editor writes for that place', () => {
    for (const kind of KINDS) {
      for (const layout of LAYOUTS_FOR_KIND[kind].filter((candidate) => STACKED.has(candidate))) {
        for (const place of ['left', 'right'] as const) {
          const drawn = effectiveLayout({ kind, layout, media: { place } });
          expect([kind, layout, place, drawn]).toEqual([
            kind,
            layout,
            place,
            layoutAllowedForKind(kind, 'split') ? layoutForMediaPlace(kind, place) : layout,
          ]);
        }
      }
    }
    // A step that names no layout gets the same treatment as its default.
    expect(effectiveLayout({ kind: 'statement', media: { place: 'right' } })).toBe('split');
    expect(effectiveLayout({ kind: 'cards', media: { place: 'left' } })).toBe('split');
  });

  it('keeps the layout for every other place and for layouts that already hold a picture', () => {
    for (const place of ['top', 'bottom', 'fill', undefined]) {
      expect(effectiveLayout({ kind: 'statement', media: { place } })).toBe('title');
      expect(effectiveLayout({ kind: 'steps', layout: 'text', media: { place } })).toBe('text');
    }
    expect(effectiveLayout({ kind: 'activity', media: { place: 'left' } })).toBe('activity');
    expect(effectiveLayout({ kind: 'media', media: { place: 'right' } })).toBe('media');
    expect(effectiveLayout({ kind: 'interaction', media: { place: 'right' } })).toBe('poll');
  });
});
