import { describe, expect, it } from 'vitest';

import { callTool, TOOL_DEFINITIONS, type ToolDeps } from '../src/index.js';

/**
 * The text budgets the outline_validate description states, held to the
 * estimator that produces W_TEXT_FIT: at the budget no warning, well past it a
 * warning. When the estimator moves, the stated budgets have to move with it.
 */

const deps = {} as ToolDeps;
const description = TOOL_DEFINITIONS.find((tool) => tool.name === 'outline_validate')!.description;

function prose(length: number): string {
  let text = '';
  while (text.length < length) text += 'les animaux ';
  return text.slice(0, length);
}

async function validate(step: Record<string, unknown>) {
  return (await callTool(deps, 'outline_validate', {
    outline: { version: 1, meta: { title: 'Le zoo' }, steps: [step], interactions: [] },
  })) as { ok: boolean; warnings: { code: string }[]; steps: { layout?: string }[] };
}

async function fits(step: Record<string, unknown>): Promise<boolean> {
  const result = await validate(step);
  expect(result.ok).toBe(true);
  return !result.warnings.some((warning) => warning.code === 'W_TEXT_FIT');
}

const list = (count: number, length: number) => Array.from({ length: count }, () => prose(length));
const cards = (count: number, length: number) => list(count, length).map((text) => ({ text }));

describe('outline_validate text budgets', () => {
  it('passes the title and statement budgets and flags text well past them', async () => {
    expect(description).toContain('a title slide heading of about 100 characters');
    expect(await fits({ id: 't', kind: 'title', title: prose(100) })).toBe(true);
    expect(await fits({ id: 't', kind: 'title', title: prose(150) })).toBe(false);
    expect(description).toContain('a statement body of about 300 characters under a short heading');
    expect(await fits({ id: 's', kind: 'statement', title: 'Le zoo', body: prose(300) })).toBe(true);
    expect(await fits({ id: 's', kind: 'statement', title: 'Le zoo', body: prose(400) })).toBe(false);
  });

  it('passes the card budgets and flags a card set past them', async () => {
    expect(description).toContain('4 cards of up to 140 characters or 6 cards of up to 70');
    expect(await fits({ id: 'c', kind: 'cards', title: 'Les animaux', items: cards(4, 140) })).toBe(true);
    expect(await fits({ id: 'c', kind: 'cards', title: 'Les animaux', items: cards(6, 70) })).toBe(true);
    expect(await fits({ id: 'c', kind: 'cards', title: 'Les animaux', items: cards(6, 140) })).toBe(false);
  });

  it('passes the list budgets on every list kind and flags a longer list', async () => {
    expect(description).toContain('6 steps, activity instructions or debrief prompts of up to 40 characters each, or 3 of up to 80');
    for (const layout of [undefined, 'text']) {
      const steps = (items: string[]) => ({ id: 's', kind: 'steps', title: 'Au zoo', items, ...(layout === undefined ? {} : { layout }) });
      expect(await fits(steps(list(6, 40)))).toBe(true);
      expect(await fits(steps(list(3, 80)))).toBe(true);
      expect(await fits(steps(list(8, 40)))).toBe(false);
    }
    expect(await fits({ id: 'a', kind: 'activity', title: 'Au zoo', instructions: list(6, 40) })).toBe(true);
    expect(await fits({ id: 'a', kind: 'activity', title: 'Au zoo', instructions: list(3, 80) })).toBe(true);
    expect(await fits({ id: 'd', kind: 'debrief', title: 'À retenir', prompts: list(6, 40) })).toBe(true);
    expect(await fits({ id: 'd', kind: 'debrief', title: 'À retenir', prompts: list(3, 80) })).toBe(true);
    expect(await fits({ id: 'd', kind: 'debrief', title: 'À retenir', prompts: list(6, 90) })).toBe(false);
  });
});

describe('the fit report on tool results', () => {
  const sideways = { id: 's', kind: 'statement', body: 'Le zoo', media: { type: 'image', url: 'https://example.test/zoo.png', alt: 'A zoo', place: 'right' } };

  it('gives outline_validate the drawn layout and the warnings', async () => {
    const result = await validate(sideways);
    expect(result.steps[0]?.layout).toBe('split');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['W_MEDIA_PLACE']);
    expect((await validate({ id: 't', kind: 'title', title: 'Le zoo' })).warnings).toEqual([]);
  });

  it('returns the warnings with a draft preview and a saved version', async () => {
    const outline = { version: 1, meta: { title: 'Le zoo' }, steps: [sideways], interactions: [] };
    const preview = (await callTool(deps, 'deck_preview', { outline })) as { warnings: { code: string }[] };
    expect(preview.warnings.map((warning) => warning.code)).toEqual(['W_MEDIA_PLACE']);
    const saving = { controlRequest: async () => ({ status: 201, body: { version: 2 } }) } as unknown as ToolDeps;
    const saved = (await callTool(saving, 'deck_save_version', { deckId: 'd1', baseVersion: 1, content: outline })) as { ok: boolean; warnings: { code: string }[] };
    expect(saved.ok).toBe(true);
    expect(saved.warnings.map((warning) => warning.code)).toEqual(['W_MEDIA_PLACE']);
  });
});
