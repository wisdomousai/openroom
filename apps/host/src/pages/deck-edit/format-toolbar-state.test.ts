import { describe, expect, it } from 'vitest';
import type { OutlineTextElement } from '@openroom/schema';

import { togglePatch, toolbarState } from './format-toolbar-state.js';
import { styleRange } from './spans.js';

/**
 * What the floating toolbar reports for a selection, and what a toggle writes.
 * Pure input/output — the DOM bridge that produces the offsets is verified in
 * the browser, but the states the toolbar can be in are pinned here.
 */

const BOX: OutlineTextElement = {
  id: 'box',
  type: 'text',
  text: 'Le passé composé',
  box: { x: 0, y: 0, w: 40, h: 12 },
};

function withSpans(spans: OutlineTextElement['spans']): OutlineTextElement {
  return { ...BOX, spans };
}

describe('toolbarState', () => {
  it('reports a format the whole range carries', () => {
    const element = withSpans([{ text: 'Le ' }, { text: 'passé', bold: true }, { text: ' composé' }]);
    expect(toolbarState(element, 3, 8).bold).toBe(true);
  });

  it('reports off when only part of the range carries it', () => {
    const element = withSpans([{ text: 'Le ' }, { text: 'passé', bold: true }, { text: ' composé' }]);
    expect(toolbarState(element, 0, 8).bold).toBe(false);
  });

  it('reports the common size, family and color of a uniform range', () => {
    const element = withSpans([
      { text: 'Le ' },
      { text: 'passé', size: 150, family: 'serif', color: '#0f6cbd' },
      { text: ' composé' },
    ]);
    const state = toolbarState(element, 3, 8);
    expect(state.size).toBe(150);
    expect(state.family).toBe('serif');
    expect(state.color).toBe('#0f6cbd');
  });

  it('reports null for size, family and color when the range mixes them', () => {
    const element = withSpans([
      { text: 'Le ', size: 150, family: 'serif', color: '#0f6cbd' },
      { text: 'passé', size: 200, family: 'mono', color: '#107c41' },
      { text: ' composé' },
    ]);
    const state = toolbarState(element, 0, 8);
    expect(state.size).toBeNull();
    expect(state.family).toBeNull();
    expect(state.color).toBeNull();
  });

  it('reports null for an unstyled range — nothing to show is the same control', () => {
    const state = toolbarState(BOX, 0, 5);
    expect(state).toMatchObject({ bold: false, italic: false, underline: false, size: null });
  });

  it('defaults alignment to left, and reads it when set', () => {
    expect(toolbarState(BOX, 0, 5).align).toBe('left');
    expect(toolbarState({ ...BOX, align: 'center' }, 0, 5).align).toBe('center');
  });
});

describe('slot mode', () => {
  /**
   * A wired kind's heading is aligned by the skin, so the toolbar has no
   * alignment to show. `null` is what hides the control — the same state a
   * mixed size or colour uses, for the same reason: there is nothing to say.
   */
  it('reports no alignment for a fixed slot', () => {
    const state = toolbarState({ text: 'Les voyages', align: null }, 0, 3);
    expect(state.align).toBeNull();
    expect(state.bold).toBe(false);
  });

  it('reads spans off a slot the same way it reads them off an element', () => {
    const state = toolbarState(
      { text: 'Les voyages', spans: [{ text: 'Les', bold: true }, { text: ' voyages' }], align: null },
      0,
      3,
    );
    expect(state.bold).toBe(true);
  });
});

describe('togglePatch', () => {
  it('turns a format on', () => {
    expect(togglePatch(toolbarState(BOX, 0, 5), 'bold')).toEqual({ bold: true });
  });

  it('turns a format off by clearing the key, not by writing false', () => {
    const element = withSpans([{ text: 'Le pa', bold: true }, { text: 'ssé composé' }]);
    const patch = togglePatch(toolbarState(element, 0, 5), 'bold');
    expect(patch).toEqual({ bold: undefined });
    // Through the real algebra the property is gone, not falsified — a span
    // carrying `bold: false` would never normalize back into plain text.
    const cleared = styleRange(element.spans ?? [], 0, 5, patch);
    expect(cleared).toEqual([{ text: 'Le passé composé' }]);
  });

  it('toggles italic and underline independently of bold', () => {
    const element = withSpans([{ text: 'Le pa', bold: true }, { text: 'ssé composé' }]);
    const state = toolbarState(element, 0, 5);
    expect(togglePatch(state, 'italic')).toEqual({ italic: true });
    expect(togglePatch(state, 'underline')).toEqual({ underline: true });
  });
});
