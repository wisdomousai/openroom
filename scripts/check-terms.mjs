/**
 * Fails when a retired term appears in a text file of the repository (tracked files
 * and new untracked files that are not ignored). The product renamed internal jargon;
 * see docs/TERMINOLOGY.md, section "Retired or avoid". Old names are not accepted
 * anywhere, so a hit is a bug even in a comment or in test text.
 *
 * Allowed: migration SQL and snapshots under apps/workspace-worker/migrations/ (old
 * migrations keep old names and new ones reference them in RENAME statements), the
 * one-shot data-migration scripts, the "Retired or avoid" table in
 * docs/TERMINOLOGY.md and the "Terminology migration" section of docs/DEPLOYMENT.md.
 *
 * Usage: node scripts/check-terms.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each pass of the rename adds its banned patterns here. */
export const BANNED = [
  { name: 'roster', pattern: /roster/i, use: 'guest list, guest link, guest-list (identityMode), guestList (entitlement)' },
  { name: 'pseudonym', pattern: /pseudonym/i, use: 'nickname (identityMode), "participants get a generated nickname"' },
  {
    name: 'participant handle',
    pattern: /recoveryHandle|yourHandle|invalid-handle|handle-recovery|handle-not-found|generateHandle|publicHandles|handlesArePublic|\bsession handle\b|\byour handle\b|\bsession-local handles?\b|\bparticipant handles?\b|rejoin with handle/i,
    use: 'name (participant name), recoveryName, yourName, invalid-name, name-recovery-unavailable, "Rejoin with your name"',
  },
  { name: 'invite query parameter', pattern: /[?&]invite=/i, use: '?guest=orinv_… (the guest link on the join page)' },
  {
    name: 'context (the tutoring entity)',
    pattern: /context_?ids?\b|context_?json|context_?name|context_?learners?|context_access|space_?contexts|context[-_]?links?\b|context[-_]?kinds?\b|\/contexts\b|tutor\/contexts|CONTEXT_(?:KIND|NOUN|LINK)|MAX_LINKS_PER_CONTEXT|IDENTIFIED_NEEDS_CONTEXT|(?:Tutoring|Session|Verified|Minted)Context\b|\b(?:list|trash|restore|update|link|require|verify|mint|revoke|fetchSession)Contexts?\b|Context(?:Kind|Summary|Fields|Panel|Dialog|Learner|Detail|Row|Form|Chip|Returned|Links?|Name|Access|Continuity|Owner)\b|context access links?|student context|identified-session-needs-context|session-not-in-context|space-has-context|context-(?:not-found|too-large|must-be-object|mismatch)|invalid-context-|wrong-context/i,
    // The Agent2Agent protocol names its conversation field `contextId`; a2a.ts passes it through.
    exceptPaths: [/^apps\/workspace-worker\/src\/a2a\.ts$/],
    use: 'student (studentId, student_id, students, StudentKind, studentLink, student-link-invalid, "student access link"; UI: "access link")',
  },
];

const ALLOWED_PATHS = [
  /^apps\/workspace-worker\/migrations\//,
  /^apps\/workspace-worker\/scripts\/terminology-[^/]+\.mjs$/,
  /^scripts\/check-terms\.mjs$/,
];

/** Sections of documents that must name retired terms to explain the migration. */
const ALLOWED_SECTIONS = {
  'docs/TERMINOLOGY.md': /^## Retired or avoid/,
  'docs/DEPLOYMENT.md': /^## Terminology migration/,
};

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 1 << 28 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const hits = [];
for (const file of files) {
  if (ALLOWED_PATHS.some((allowed) => allowed.test(file))) continue;
  let buffer;
  try {
    buffer = readFileSync(resolve(root, file));
  } catch {
    continue; // deleted in the working tree
  }
  if (buffer.includes(0)) continue; // binary
  let retiredTable = false;
  const lines = buffer.toString('utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const allowedSection = ALLOWED_SECTIONS[file];
    if (allowedSection !== undefined) {
      if (/^## /.test(line)) retiredTable = allowedSection.test(line);
      if (retiredTable) continue;
    }
    for (const banned of BANNED) {
      if (banned.exceptPaths?.some((except) => except.test(file))) continue;
      if (banned.pattern.test(line)) hits.push(`${file}:${index + 1}: "${banned.name}" is retired; use ${banned.use}`);
    }
  }
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error(`\n${hits.length} retired term(s) found. See docs/TERMINOLOGY.md.`);
  process.exit(1);
}
console.log('No retired terms found.');
