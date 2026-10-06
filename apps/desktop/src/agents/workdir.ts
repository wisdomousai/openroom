import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { agentSkillsContext, SKILL_NAMES } from './instructions.js';
import type { McpStdioCommand } from './types.js';

export { SKILL_NAMES };

export interface WorkdirInput {
  root: string;
  /** Temporary root for copied attachments; never the persistent deck workspace. */
  attachmentsRoot?: string;
  attachments: string[];
  skillsRoot: string;
  mcp: McpStdioCommand;
  copyFile?: (from: string, to: string) => Promise<void>;
  writeFile?: (path: string, contents: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
}

export interface AgentWorkdir {
  path: string;
  attachmentsDir: string;
  attachmentNames: string[];
  claudeMcpConfigPath: string;
}

export function claudeMcpConfig(mcp: McpStdioCommand): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        openroom: {
          command: mcp.command,
          args: mcp.args,
          env: mcp.env,
        },
      },
    },
    null,
    2,
  )}\n`;
}

export async function createAgentWorkdir(input: WorkdirInput): Promise<AgentWorkdir> {
  const mkdirFn = input.mkdir ?? ((path: string) => mkdir(path, { recursive: true }).then(() => undefined));
  const writeFn = input.writeFile ?? ((path: string, contents: string) => writeFile(path, contents, 'utf8'));
  const copyFn = input.copyFile ?? ((from: string, to: string) => cp(from, to));

  const attachmentsDir = join(input.attachmentsRoot ?? input.root, 'attachments');
  const claudeMcpConfigPath = join(input.root, 'mcp.json');

  await mkdirFn(input.root);
  await mkdirFn(attachmentsDir);
  await mkdirFn(join(input.root, '.claude', 'skills'));
  await mkdirFn(join(input.root, '.agents', 'skills'));

  // The brief *and* the skills, not just the brief. Codex reads the project
  // AGENTS.md and its SDK exposes no system-prompt option; Claude reads
  // CLAUDE.md through settingSources: ['project']. Leaving the skills to
  // folder discovery alone means the model has to choose to open one, and it
  // often does not. The folders below stay for a deliberate re-read.
  const context = await agentSkillsContext(input.skillsRoot);
  await writeFn(join(input.root, 'AGENTS.md'), context);
  await writeFn(join(input.root, 'CLAUDE.md'), context);
  await writeFn(claudeMcpConfigPath, claudeMcpConfig(input.mcp));

  for (const name of SKILL_NAMES) {
    const source = join(input.skillsRoot, name, 'SKILL.md');
    let text: string;
    try {
      text = await readFile(source, 'utf8');
    } catch {
      continue;
    }
    await mkdirFn(join(input.root, '.claude', 'skills', name));
    await mkdirFn(join(input.root, '.agents', 'skills', name));
    await writeFn(join(input.root, '.claude', 'skills', name, 'SKILL.md'), text);
    await writeFn(join(input.root, '.agents', 'skills', name, 'SKILL.md'), text);
  }

  const attachmentNames = await addAttachments(attachmentsDir, input.attachments, copyFn);

  return {
    path: input.root,
    attachmentsDir,
    attachmentNames,
    claudeMcpConfigPath,
  };
}

export async function addAttachments(
  attachmentsDir: string,
  attachments: string[],
  copyFile?: (from: string, to: string) => Promise<void>,
): Promise<string[]> {
  const copyFn = copyFile ?? ((from: string, to: string) => cp(from, to));
  await mkdir(attachmentsDir, { recursive: true });
  const names: string[] = [];
  for (const attachment of attachments) {
    const name = basename(attachment);
    if (name === '' || name === '.' || name === '..') continue;
    names.push(name);
    await copyFn(attachment, join(attachmentsDir, name));
  }
  return names;
}

export async function removeAgentWorkdir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
