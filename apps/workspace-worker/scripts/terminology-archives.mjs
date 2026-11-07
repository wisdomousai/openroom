/**
 * One-shot rewrite of R2 session archives (objects `archives/<session code>.json`) for the
 * terminology rename:
 *  - the key `ballotsCsv` (the kept per-person answers CSV) is now `answersCsv`;
 *  - the participant column of that CSV was called `handle` and is now `name` (migration
 *    0002_nickname), so its header line is rewritten;
 *  - anonymized asker ids in the aggregates were `purged-<n>` and are now `deleted-<n>`.
 * Safe to run twice.
 *
 * It never talks to Cloudflare. Download the archives, run this on the folder, upload them
 * back; docs/DEPLOYMENT.md, section "Terminology migration", has the commands.
 *
 *   node apps/workspace-worker/scripts/terminology-archives.mjs <folder> [--dry-run]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OLD_HEADER = 'interactionId,prompt,participantId,handle,answer,hidden';
const NEW_HEADER = 'interactionId,prompt,participantId,name,answer,hidden';

/** Returns the rewritten archive text, or null when nothing in it needs to change. */
export function rewriteArchive(text) {
  const record = JSON.parse(text);
  if (record === null || typeof record !== 'object') return null;
  let changed = false;
  // The kept per-person CSV was stored under `ballotsCsv`; it is `answersCsv` now.
  if (typeof record.ballotsCsv === 'string') {
    if (typeof record.answersCsv !== 'string') record.answersCsv = record.ballotsCsv;
    delete record.ballotsCsv;
    changed = true;
  }
  if (typeof record.answersCsv === 'string') {
    const newline = record.answersCsv.indexOf('\n');
    const header = newline === -1 ? record.answersCsv : record.answersCsv.slice(0, newline);
    if (header === OLD_HEADER) {
      record.answersCsv = NEW_HEADER + (newline === -1 ? '' : record.answersCsv.slice(newline));
      changed = true;
    }
  }
  // The timed deletion of individual answers labelled askers `purged-<n>`; it now writes `deleted-<n>`.
  const before = JSON.stringify(record);
  const after = before.replace(/"purged-(\d+)"/g, '"deleted-$1"');
  if (after !== before) changed = true;
  return changed ? after : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((arg) => !arg.startsWith('--'));
  if (!folder) {
    console.error('Usage: node terminology-archives.mjs <folder> [--dry-run]');
    process.exit(2);
  }
  let rewritten = 0;
  let unchanged = 0;
  for (const entry of await readdir(folder)) {
    if (!entry.endsWith('.json')) continue;
    const file = resolve(folder, entry);
    const next = rewriteArchive(await readFile(file, 'utf8'));
    if (next === null) {
      unchanged += 1;
      continue;
    }
    if (!dryRun) await writeFile(file, next);
    rewritten += 1;
    console.log(`${dryRun ? 'would rewrite' : 'rewrote'} ${entry}`);
  }
  console.log(`${rewritten} rewritten, ${unchanged} unchanged${dryRun ? ' (dry run)' : ''}.`);
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) await main();
