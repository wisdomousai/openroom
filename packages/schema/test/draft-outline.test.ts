import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { asCompiledOutline, compileOutline, compileToOutline, parseOutline, parseStartOutline, validateOutline, validateSession, type Interaction, type Outline } from '../src/index.js';

const outlineOf = (interaction: Interaction): Outline => ({ version: 1, meta: { title: 'Draft' }, steps: [{ id: 'question', kind: 'interaction', interactionId: interaction.id }], interactions: [interaction] });

describe('unfinished deck content', () => {
  it.each<Interaction>([
    { id: 'q', type: 'choice', prompt: '', options: [{ id: 'a', label: '' }, { id: 'b', label: '' }] },
    { id: 'q', type: 'ranking', prompt: 'Order these', options: [{ id: 'a', label: ' ' }, { id: 'b', label: 'Second' }] },
    { id: 'q', type: 'text', prompt: '   ' },
    { id: 'q', type: 'fill-the-gaps', prompt: '', gaps: [] },
    { id: 'q', type: 'fill-the-gaps', prompt: 'Hello {{word}}', gaps: [{ id: 'word', answers: [''] }] },
    { id: 'q', type: 'match', prompt: 'Match', left: [{ id: 'a', label: '' }, { id: 'b', label: '' }], right: [{ id: 'a', label: '' }, { id: 'b', label: '' }], correct: { a: 'a', b: 'b' } },
  ])('saves and reloads $type without treating unfinished content as ready to start', (interaction) => {
    const outline = outlineOf(interaction);
    const saved = parseOutline(stringify(outline));
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.outline).toEqual(outline);
    expect(asCompiledOutline(saved)).toBeNull();
    expect(compileOutline(outline).ok).toBe(false);
    expect(compileToOutline(outline).ok).toBe(false);
    expect(parseStartOutline(stringify(outline)).ok).toBe(false);
    expect(validateSession({ version: 1, meta: outline.meta, interactions: [interaction] }).ok).toBe(false);
  });

  it('keeps reference validation while saving a draft, then admits a completed question', () => {
    const outline = outlineOf({ id: 'q', type: 'choice', prompt: 'Ready?', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] });
    expect(compileOutline(outline).ok).toBe(true);
    outline.steps = [{ id: 'question', kind: 'interaction', interactionId: 'missing' }];
    expect(validateOutline(outline).ok).toBe(false);
  });

  it('round-trips empty slide and homework fields without supplying replacement text', () => {
    const outline: Outline = { version: 1, meta: { title: 'Unfinished' }, interactions: [], steps: [{ id: 's', kind: 'title', title: '', body: '', elements: [{ id: 'text', type: 'text', text: '', box: { x: 10, y: 10, w: 40, h: 20 } }] }], homework: { tasks: [{ id: 'read', kind: 'reading', body: '' }, { id: 'write', kind: 'writing', prompt: '' }] } };
    const result = parseOutline(stringify(outline));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outline).toEqual(outline);
  });
});
