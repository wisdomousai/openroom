import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SKILL_NAMES, claudeMcpConfig, createAgentWorkdir, removeAgentWorkdir } from './workdir.js';

const mcp = {
  command: '/App/OpenRoom',
  args: ['/App/mcp-stdio.js', '--socket', '/tmp/mcp.sock'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};

describe('agent workdir', () => {
  it('writes MCP config that points at openroom via the desktop sidecar', () => {
    const parsed = JSON.parse(claudeMcpConfig(mcp)) as {
      mcpServers: { openroom: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.openroom.command).toBe('/App/OpenRoom');
    expect(parsed.mcpServers.openroom.args).toEqual(['/App/mcp-stdio.js', '--socket', '/tmp/mcp.sock']);
  });

  it('ships every plugin skill into agent workdirs', async () => {
    const pluginSkills = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..', 'plugin', 'skills');
    const published = (await readdir(pluginSkills, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...SKILL_NAMES].sort()).toEqual(published);
  });

  it('copies attachments and skills, then cleanup removes the school files', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'openroom-agent-'));
    const skillsRoot = join(parent, 'skills');
    const attachmentsSrc = join(parent, 'src');
    const root = join(parent, 'workspace');
    const attachmentsRoot = join(parent, 'run');
    await mkdir(join(skillsRoot, 'prepare-a-tutoring-outline'), { recursive: true });
    await writeFile(join(skillsRoot, 'prepare-a-tutoring-outline', 'SKILL.md'), '# Prepare', 'utf8');
    await mkdir(join(skillsRoot, 'port-a-deck'), { recursive: true });
    await writeFile(join(skillsRoot, 'port-a-deck', 'SKILL.md'), '# Port', 'utf8');
    await mkdir(attachmentsSrc, { recursive: true });
    await writeFile(join(attachmentsSrc, 'friday-test.pdf'), 'pdf', 'utf8');

    const workdir = await createAgentWorkdir({
      root,
      attachmentsRoot,
      attachments: [join(attachmentsSrc, 'friday-test.pdf')],
      skillsRoot,
      mcp,
    });

    expect(workdir.attachmentNames).toEqual(['friday-test.pdf']);
    expect(await readFile(join(workdir.attachmentsDir, 'friday-test.pdf'), 'utf8')).toBe('pdf');
    expect(await readFile(join(root, '.claude', 'skills', 'prepare-a-tutoring-outline', 'SKILL.md'), 'utf8')).toContain(
      'Prepare',
    );
    expect(await readFile(join(root, '.claude', 'skills', 'port-a-deck', 'SKILL.md'), 'utf8')).toContain('Port');
    expect(await readFile(workdir.claudeMcpConfigPath, 'utf8')).toContain('mcp-stdio.js');

    // Both SDK hosts read their context document off disk, so the skills go in
    // it — folder discovery alone leaves loading them to the model's choice.
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const context = await readFile(join(root, name), 'utf8');
      expect(context).toContain('Never upload');
      expect(context).toContain('## Skill: prepare-a-tutoring-outline');
      expect(context).toContain('# Prepare');
      expect(context).toContain('## Skill: port-a-deck');
      expect(context).toContain('# Port');
      // Skills that were not packaged are skipped, not fatal.
      expect(context).not.toContain('## Skill: run-a-session');
    }

    await removeAgentWorkdir(attachmentsRoot);
    await expect(readFile(join(attachmentsRoot, 'attachments', 'friday-test.pdf'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('persistent deck workspace');
    await rm(parent, { recursive: true, force: true });
  });
});
