#!/usr/bin/env node
/**
 * Publish Agent Skills Discovery (RFC v0.2.0) into the Astro public tree.
 *
 * Canonical skills live in `plugin/skills/<name>/SKILL.md` (API-09: store once).
 * This script copies each skill into
 * `public/.well-known/agent-skills/<name>/SKILL.md` and writes
 * `public/.well-known/agent-skills/index.json` with SHA-256 digests.
 *
 * Run before `astro build` so the Worker ASSETS binding serves the index.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const skillsRoot = resolve(siteRoot, '../../plugin/skills');
const outRoot = join(siteRoot, 'public/.well-known/agent-skills');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Fold YAML `>-` / `>` block scalars and quoted scalars into a single line. */
function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) {
    throw new Error('SKILL.md missing YAML frontmatter');
  }
  const end = md.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('SKILL.md frontmatter not closed');
  const fm = md.slice(4, end);

  const nameMatch = fm.match(/^name:\s*(.+)\s*$/m);
  if (!nameMatch) throw new Error('SKILL.md frontmatter missing name');
  const name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

  const descMatch = fm.match(/^description:\s*(>-?|>|)\|?-?\s*\n((?:[ \t]+.+\n?)*)/m);
  let description;
  if (descMatch) {
    description = descMatch[2]
      .split('\n')
      .map((line) => line.replace(/^[ \t]+/, ''))
      .filter((line) => line.length > 0)
      .join(' ')
      .trim();
  } else {
    const inline = fm.match(/^description:\s*(.+)\s*$/m);
    if (!inline) throw new Error('SKILL.md frontmatter missing description');
    description = inline[1].trim().replace(/^["']|["']$/g, '');
  }

  if (!NAME_RE.test(name)) {
    throw new Error(`invalid skill name "${name}" (Agent Skills naming rules)`);
  }
  if (description.length === 0 || description.length > 1024) {
    throw new Error(`description for "${name}" must be 1–1024 characters`);
  }
  return { name, description };
}

async function main() {
  if (!(await exists(skillsRoot))) {
    throw new Error(`skills source missing: ${skillsRoot}`);
  }

  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const entries = [];
  for (const dir of await readdir(skillsRoot)) {
    const skillMd = join(skillsRoot, dir, 'SKILL.md');
    if (!(await exists(skillMd))) continue;

    const bytes = await readFile(skillMd);
    const text = bytes.toString('utf8');
    const { name, description } = parseFrontmatter(text);
    if (name !== dir) {
      throw new Error(`skill directory "${dir}" does not match frontmatter name "${name}"`);
    }

    const destDir = join(outRoot, name);
    await mkdir(destDir, { recursive: true });
    await cp(skillMd, join(destDir, 'SKILL.md'));

    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    entries.push({
      name,
      type: 'skill-md',
      description,
      url: `/.well-known/agent-skills/${name}/SKILL.md`,
      digest,
    });
    console.log(`[publish-agent-skills] ${name} ${digest}`);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) {
    throw new Error(`no SKILL.md files found under ${skillsRoot}`);
  }

  const index = { $schema: SCHEMA, skills: entries };
  const indexPath = join(outRoot, 'index.json');
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[publish-agent-skills] wrote ${entries.length} skill(s) → ${indexPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
