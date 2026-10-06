import { describe, expect, it } from 'vitest';

import { agentSkillsContext, agentUserPrompt, byokSystemPrompt } from './instructions.js';

const skillFiles: Record<string, string> = {
  'prepare-a-tutoring-outline/SKILL.md': '# Prepare\nPick a picture with picture_search.',
  'run-a-session/SKILL.md': '# Run',
};

async function readSkill(path: string): Promise<string> {
  for (const [suffix, text] of Object.entries(skillFiles)) {
    if (path.endsWith(suffix)) return text;
  }
  throw new Error(`not packaged: ${path}`);
}

describe('agentSkillsContext', () => {
  it('carries the brief and every packaged skill, skipping ones that are missing', async () => {
    const context = await agentSkillsContext('/skills', readSkill);
    expect(context).toContain('Never upload');
    expect(context).toContain('## Skill: prepare-a-tutoring-outline');
    expect(context).toContain('picture_search');
    expect(context).toContain('## Skill: run-a-session');
    expect(context).not.toContain('## Skill: port-a-deck');
  });

  it('byokSystemPrompt adds the no-shell paragraph before the skills', async () => {
    const prompt = await byokSystemPrompt('/skills', readSkill);
    expect(prompt).toContain('You have no shell and no way to write files');
    expect(prompt.indexOf('read_file')).toBeLessThan(prompt.indexOf('## Skill:'));
  });

  /**
   * This prompt is the bulk of the API-key host's cacheable prefix, so a stray
   * date, path, or id in it would silently cost every tutor a cache miss per
   * turn. The snapshot is here to make that show up as a failing test rather
   * than as a bill.
   */
  it('is byte-identical across calls and carries nothing per-run', async () => {
    const first = await byokSystemPrompt('/skills', readSkill);
    const second = await byokSystemPrompt('/other-skills-root', readSkill);

    expect(first).toBe(second);
    expect(first).toMatchSnapshot();
  });
});

describe('agentUserPrompt', () => {
  it('targets the hosted deck when the run comes from the deck editor', () => {
    const prompt = agentUserPrompt('Add a warm-up', [], [], 'deck-281');
    expect(prompt).toContain('Target: hosted deck deck-281');
    expect(prompt).toContain('deck_get({ deckId: "deck-281" })');
  });

  it('stays on the open-file story when no deck is given', () => {
    const prompt = agentUserPrompt('Add a warm-up', ['/tmp/attachments/sheet.pdf']);
    expect(prompt).not.toContain('Target: hosted deck');
    expect(prompt).toContain('/tmp/attachments/sheet.pdf');
    expect(prompt).toContain('do not copy them into the workspace');
    expect(prompt).toContain('Do not narrate skill selection');
  });
});
