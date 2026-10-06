import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SKILL_NAMES = [
  'prepare-a-tutoring-outline',
  'prepare-a-language-outline',
  'run-a-session',
  'port-a-deck',
  'make-this-interactive',
] as const;

/** Short workdir brief. Skills in this directory carry the full contract. */
export const AGENT_WORKDIR_BRIEF = `OpenRoom Desktop launched you to prepare the open deck.

Read attached school files only from the temporary paths named in the turn.
They stay on this computer. Never upload them, quote them wholesale, send
them through OpenRoom, or copy them into this persistent deck workspace.

Use the openroom MCP tools. Validate with outline_validate. Save the typed
Outline through deck_save_version or deck_draft_put. The desktop app is
already hosting those tools — bound to the open .openroom file when this
conversation started from one, and to the tutor's signed-in OpenRoom account
otherwise. Do not configure a second MCP server. If a choice would change
the outline, call ask_question instead of guessing.

Hard boundary:
- Send only a typed Outline v1 (semantic steps, no CSS, no coordinates).
- Do not wrap a model, invent a layout language, or ask OpenRoom to generate.
- The tutor stays in control. Propose live insertions; do not show them until asked.
- Do not narrate skill selection, tool discovery, retries, or your workflow.
  Start with the needed read or validation call. Keep any necessary progress
  note to one short sentence; reserve the normal answer for the final outcome.

If the tutor asked for a language hour, follow prepare-a-language-outline.
Otherwise follow prepare-a-tutoring-outline.
`;

function folderLines(folderPaths: string[]): string {
  if (folderPaths.length === 0) return '';
  return `\nReference folders on this computer (read them in place — never copy their contents into OpenRoom or upload them):\n${folderPaths.map((path) => `- ${path}`).join('\n')}\n`;
}

export function agentUserPrompt(
  request: string,
  attachmentPaths: string[],
  folderPaths: string[] = [],
  deckId: string | null = null,
): string {
  const files =
    attachmentPaths.length === 0 && folderPaths.length === 0
      ? 'No school files were attached. Work from the tutor request and the current outline.'
      : attachmentPaths.length === 0
        ? 'No individual files were attached.'
        : `Temporary attached files (read in place; do not copy them into the workspace):\n${attachmentPaths.map((path) => `- ${path}`).join('\n')}`;
  const target =
    deckId === null
      ? ''
      : `\nTarget: hosted deck ${deckId}. Read it with deck_get({ deckId: "${deckId}" }) and save with deck_save_version against the baseVersion you read. On a version-conflict, re-read and re-apply — never retry the same body.\n`;
  return `Prepare this OpenRoom deck.

Tutor request:
${request.trim()}
${target}
${files}
${folderLines(folderPaths)}
${AGENT_WORKDIR_BRIEF}`;
}

/** Later conversation turns: resume carries the context; only flag newly added material. */
export function agentFollowUpPrompt(request: string, newAttachmentPaths: string[], newFolderPaths: string[]): string {
  const parts = [request.trim()];
  if (newAttachmentPaths.length > 0) {
    parts.push(
      `New temporary attached files (read in place; do not copy them into the workspace):\n${newAttachmentPaths.map((path) => `- ${path}`).join('\n')}`,
    );
  }
  if (newFolderPaths.length > 0) {
    parts.push(
      `New reference folders (read in place, never copy or upload):\n${newFolderPaths.map((path) => `- ${path}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * The brief plus every skill, as one document.
 *
 * All skills, always. A skill the runtime merely *offers* is a skill the model
 * may never open: the SDK hosts see `.claude/skills` / `.agents/skills` as
 * discoverable folders and have to choose to load one, and the in-process host
 * has no Skill tool at all. The whole set is small next to the MCP tool
 * schemas, so every harness carries it outright instead.
 *
 * A skill that cannot be read is skipped rather than fatal: a packaging slip
 * should cost one skill, not the agent.
 */
export async function agentSkillsContext(
  skillsRoot: string,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  briefSuffix?: string,
): Promise<string> {
  const sections = [
    briefSuffix === undefined ? AGENT_WORKDIR_BRIEF : `${AGENT_WORKDIR_BRIEF}\n\n${briefSuffix}`,
  ];
  for (const name of SKILL_NAMES) {
    let text: string;
    try {
      text = await read(join(skillsRoot, name, 'SKILL.md'));
    } catch {
      continue;
    }
    sections.push(`## Skill: ${name}\n${text}`);
  }
  return sections.join('\n\n');
}

/**
 * System prompt for the in-process API-key host.
 *
 * The same document the workdir hosts read off disk, plus the one paragraph
 * that is only true here: no shell, no file writes, and read_file in place of
 * the CLI's own file tools.
 */
export async function byokSystemPrompt(
  skillsRoot: string,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<string> {
  return agentSkillsContext(
    skillsRoot,
    read,
    `Your tools are the openroom MCP tools and read_file. They are pre-approved —
call them directly. You have no shell and no way to write files. read_file
reaches the attached school files and the folders named in the turn; anything
else is refused.`,
  );
}

/** Skills are packaged assets: they cannot change while the app runs. */
export function memoizedByokSystemPrompt(skillsRoot: () => string): () => Promise<string> {
  let cached: Promise<string> | null = null;
  return () => {
    cached ??= byokSystemPrompt(skillsRoot());
    return cached;
  };
}
