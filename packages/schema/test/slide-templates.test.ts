import { describe, it, expect } from 'vitest';
import { SLIDE_TEMPLATES } from '../src/slide-templates';
import { defaultDeckDesign } from '../src/deck-design';
import { validateOutline, parseOutline } from '../src/outline';
import { stringify } from 'yaml';

describe('editable slide templates', () => {
  for (const template of SLIDE_TEMPLATES) {
    it(`${template.name} is a complete valid document fragment`, () => {
      const outline = { version: 1, meta: { title: template.name }, design: defaultDeckDesign(), steps: [{ ...template.step, design: { templateId: template.id } }], interactions: template.interaction ? [template.interaction] : [] };
      expect(validateOutline(outline)).toMatchObject({ ok: true });
      expect(parseOutline(stringify(outline), 'yaml')).toMatchObject({ ok: true });
    });
  }
});
