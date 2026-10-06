import { describe, expect, it } from 'vitest';
import { defaultDeckDesign, resolveSlideDesign, SLIDE_THEME_FAMILIES } from '../src/deck-design.js';
import { parseOutline, validateOutline } from '../src/outline.js';
import type { Outline } from '../src/outline-types.js';

const deck = (): Outline => ({ version: 1, meta: { title: 'Design' }, design: defaultDeckDesign(), steps: [{ id: 'title', kind: 'title', title: 'Bonjour' }], interactions: [] });

describe('saved deck design', () => {
  it.each(SLIDE_THEME_FAMILIES)('round trips the resolved %s theme and isolates each copy', (family) => {
    const outline = { ...deck(), design: defaultDeckDesign(family) };
    const parsed = parseOutline(JSON.stringify(outline), 'json');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.outline.design).toEqual(outline.design);
    const view = resolveSlideDesign(outline.design);
    view.theme.colors.accent = '#000000';
    expect(outline.design.theme.colors.accent).not.toBe('#000000');
  });

  it('resolves slide overrides and selectively hides reusable decorations', () => {
    const design = defaultDeckDesign('business');
    design.masters.push({ id: 'section', name: 'Section', safeArea: 8, decoration: 'rule', footer: 'Training', background: { kind: 'gradient', from: '#112233', to: '#334455', angle: 30 } });
    expect(resolveSlideDesign(design, { masterId: 'section' })).toMatchObject({ safeArea: 8, decoration: 'rule', footer: 'Training', background: { kind: 'gradient', angle: 30 } });
    const clean = resolveSlideDesign(design, { masterId: 'section', hideMasterDecorations: true, background: { kind: 'solid', color: '#FFFFFF' } });
    expect(clean).toMatchObject({ safeArea: 8, decoration: 'none', background: { kind: 'solid', color: '#FFFFFF' } });
    expect(clean.footer).toBeUndefined();
  });

  it('rejects missing and duplicate master references', () => {
    const outline = deck();
    outline.steps[0]!.design = { masterId: 'missing' };
    expect(validateOutline(outline)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ path: '/steps/0/design/masterId' })]) });
    outline.steps[0]!.design = {};
    outline.design!.masters.push({ ...outline.design!.masters[0]! });
    outline.design!.defaultMasterId = 'unknown';
    expect(validateOutline(outline)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ path: '/design/masters/1/id' }), expect.objectContaining({ path: '/design/defaultMasterId' })]) });
  });

  it('rejects arbitrary CSS and out of range background settings', () => {
    const outline = deck();
    outline.design!.theme.colors.accent = 'url(https://example.com)';
    expect(validateOutline(outline).ok).toBe(false);
    outline.design = defaultDeckDesign();
    outline.design.masters[0]!.background = { kind: 'image', url: 'javascript:alert(1)', focal: { x: 101, y: 50 }, overlay: { color: '#FFFFFF', opacity: 2 } };
    expect(validateOutline(outline).ok).toBe(false);
  });
});
