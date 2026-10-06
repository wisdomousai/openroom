import { expect, it } from 'vitest';
import { defaultDeckDesign, validateOutline, type Outline } from '@openroom/schema';
import { applyBrandKit } from './design';

it('applies a kit to all slides as independent saved values, retaining content and template composition', () => {
  const outline: Outline = { version: 1, meta: { title: 'Workshop' }, interactions: [], design: defaultDeckDesign(),
    steps: [{ id: 'first', kind: 'statement', title: 'Discuss', body: 'One idea', design: { masterId: 'standard', hideMasterDecorations: true, templateId: 'statement', background: { kind: 'solid', color: '#FF0000' } } }] };
  const kit = defaultDeckDesign('business'); kit.masters[0]!.footer = 'Company';
  const applied = applyBrandKit(outline, kit);
  expect(applied.steps[0]).toEqual({ id: 'first', kind: 'statement', title: 'Discuss', body: 'One idea', design: { templateId: 'statement' } });
  expect(validateOutline(applied).ok).toBe(true);
  kit.masters[0]!.footer = 'Changed kit';
  expect(applied.design?.masters[0]?.footer).toBe('Company');
  expect(outline.steps[0]?.design?.hideMasterDecorations).toBe(true);
});
