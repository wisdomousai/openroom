import { describe, expect, it } from 'vitest';
import { parseRecapSelection, recapHtml } from '../src/session-recap.js';

describe('shareable recap', () => {
  it('accepts explicit choices and bounds every selection and authored field', () => {
    const selection = { revision: 4, title: ' Decisions ', resultIds: ['r0'], discussionIds: ['d2-0'], questionIds: ['q0'], discussion: '', followUp: ' Pilot ' };
    expect(parseRecapSelection(selection)).toMatchObject({ title: 'Decisions', followUp: 'Pilot' });
    for (const patch of [{ revision: -1 }, { revision: 2.5 }, { resultIds: ['r0', 'r0'] }, { discussionIds: ['someone'] }, { questionIds: Array.from({ length: 201 }, (_, i) => `q${i}`) }, { title: ' ' }, { followUp: 'x'.repeat(10001) }, { notes: 'private' }]) expect(parseRecapSelection({ ...selection, ...patch })).toBeNull();
  });
  it('renders plain text without executable HTML or active audience links', () => {
    const payload = '</title><script>alert(1)</script><img src="https://example.test/leak">';
    const html = recapHtml({ title: payload, results: [{ prompt: payload, responses: 2, unit: 'group responses', measure: 'Responses', rows: [{ label: payload, value: 2 }] }], discussionPoints: [{ prompt: payload, text: payload }], questions: [], discussion: payload, followUp: payload });
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'"); expect(html).toContain('2 group responses');
  });
});
