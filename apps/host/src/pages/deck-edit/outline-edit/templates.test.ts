import { describe, expect, it } from 'vitest';
import { SLIDE_TEMPLATES, WORKSHOP_SEQUENCES, type Outline } from '@openroom/schema';
import { editorRoundtrip } from '../outline-fuzz';
import { insertTemplate, insertWorkshop, resetTemplateFormatting } from './templates';
import { setDeckDesign } from './design';
import { defaultDeckDesign } from '@openroom/schema';

const blank = (): Outline => ({ version: 1, meta: { title: 'Lesson' }, steps: [{ id: 'opening', kind: 'title', title: 'Welcome' }], interactions: [] });

describe('template editor writes', () => {
  it('inserts each workshop twice with fresh references, editable questions, and the existing deck design', () => {
    let outline = blank();
    outline.design = defaultDeckDesign();
    for (const sequence of WORKSHOP_SEQUENCES) for (let repeat = 0; repeat < 2; repeat++) {
      const next = insertWorkshop(outline, outline.steps.at(-1)!.id, sequence.id);
      expect(next.stepId, sequence.id).not.toBe('');
      expect(next.outline.steps).toHaveLength(outline.steps.length + sequence.steps.length);
      expect(next.outline.design).toEqual(outline.design);
      expect(editorRoundtrip(next.outline)).toMatchObject({ ok: true });
      const added = next.outline.interactions.slice(outline.interactions.length);
      expect(added.map(({ id, ...rest }) => rest)).toEqual(sequence.interactions.map(({ id, ...rest }) => rest));
      expect(new Set([...next.outline.steps, ...next.outline.interactions].map((item) => item.id)).size).toBe(next.outline.steps.length + next.outline.interactions.length);
      outline = next.outline;
    }
  });

  it('inserts every composition twice without colliding IDs or changing answers', () => {
    let outline = blank();
    for (const template of SLIDE_TEMPLATES) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const next = insertTemplate(outline, outline.steps.at(-1)!.id, template.id);
        expect(next.stepId, template.id).not.toBe('');
        expect(next.outline.steps.length).toBe(outline.steps.length + 1);
        expect(editorRoundtrip(next.outline)).toMatchObject({ ok: true });
        if (template.interaction) {
          const interaction = next.outline.interactions.at(-1)!;
          expect({ ...interaction, id: template.interaction.id }).toEqual(template.interaction);
        }
        outline = next.outline;
      }
    }
  });

  it('restores formatting while keeping edited content, reveals and tutor notes', () => {
    const inserted = insertTemplate(blank(), 'opening', 'comparison');
    const step = inserted.outline.steps.at(-1)!;
    if (step.kind !== 'cards') throw new Error('Expected comparison cards');
    step.items[0]!.text = 'Our own example';
    step.items[0]!.textSpans = [{ text: 'Our own example', bold: true }];
    step.layout = 'split';
    step.reveal = [['header'], ['cell-0'], ['cell-1']];
    step.tutorNotes = 'Invite a second perspective.';
    step.design!.background = { kind: 'solid', color: '#FFFFFF' };
    const reset = resetTemplateFormatting(inserted.outline, step.id);
    expect(reset.steps.at(-1)).toMatchObject({ id: step.id, layout: 'grid', items: [{ text: 'Our own example' }, step.items[1]], reveal: step.reveal, tutorNotes: step.tutorNotes, design: { templateId: 'comparison' } });
    expect(editorRoundtrip(reset)).toMatchObject({ ok: true });
  });

  it('removing an assigned master reassigns slides atomically to the chosen default', () => {
    const outline = blank();
    const design = defaultDeckDesign();
    design.masters.push({ id: 'special', name: 'Special', safeArea: 8, decoration: 'rule' });
    outline.design = design;
    outline.steps[0]!.design = { masterId: 'special', templateId: 'title' };
    const next = setDeckDesign(outline, { ...design, masters: [design.masters[0]!] });
    expect(next.steps[0]!.design).toEqual({ masterId: 'standard', templateId: 'title' });
    expect(editorRoundtrip(next)).toMatchObject({ ok: true });
  });
});
