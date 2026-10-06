import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  normalizeSession,
  parseStartOutline,
  participantView,
  toSession,
  type Interaction,
  type Outline,
  type SessionError,
} from '@openroom/schema';

import { flagBool, UsageError, type ParsedArgs } from '../args.js';
import { CliError, Reporter } from '../output.js';
import { STARTER_SESSION_YAML } from '../starter.js';

export function readSessionFile(file: string): string {
  const path = resolve(process.cwd(), file);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new CliError(`cannot read outline file: ${path}`, { code: 'E_FILE', path });
  }
}

/** parseStartOutline or throw a CliError carrying the structured errors. */
export function parseOrThrow(text: string, file: string): Outline {
  const result = parseStartOutline(text);
  if (!result.ok) {
    throw new CliError(`${file} is not a valid outline`, {
      code: 'E_INVALID_OUTLINE',
      errors: result.errors,
    });
  }
  return result.outline;
}

export function cmdInit(args: ParsedArgs, reporter: Reporter): number {
  const target = args.positionals[1] ?? 'session.yaml';
  const path = resolve(process.cwd(), target);
  const force = flagBool(args, 'force');

  if (existsSync(path) && !force) {
    throw new CliError(`refusing to overwrite ${path} (pass --force to replace it)`, {
      code: 'E_EXISTS',
      path,
    });
  }

  writeFileSync(path, STARTER_SESSION_YAML, 'utf8');
  reporter.line(`✓ wrote starter session to ${path}`);
  reporter.line(`  next: openroom validate ${target}`);
  reporter.emit({ ok: true, path });
  return 0;
}

export function cmdValidate(args: ParsedArgs, reporter: Reporter): number {
  const file = args.positionals[1];
  if (file === undefined) throw new UsageError('usage: openroom validate <file>');

  const result = parseStartOutline(readSessionFile(file));
  if (!result.ok) {
    printErrors(result.errors, reporter);
    reporter.emit({ ok: false, errors: result.errors, interactionCount: 0 });
    return 1;
  }

  const count = result.outline.interactions.length;
  reporter.line(`✓ valid (${count} interaction${count === 1 ? '' : 's'})`);
  reporter.emit({ ok: true, errors: [], interactionCount: count });
  return 0;
}

function printErrors(errors: readonly SessionError[], reporter: Reporter): void {
  for (const error of errors) {
    reporter.errorLine(`${error.code} ${error.path} ${error.message}`);
  }
}

export function cmdPreview(args: ParsedArgs, reporter: Reporter): number {
  const file = args.positionals[1];
  if (file === undefined) throw new UsageError('usage: openroom preview <file>');

  const result = parseStartOutline(readSessionFile(file));
  if (!result.ok) {
    printErrors(result.errors, reporter);
    reporter.emit({ ok: false, errors: result.errors, interactionCount: 0 });
    return 1;
  }

  const session = normalizeSession(toSession(result.outline));
  const views = session.interactions.map((interaction) => participantView(session, interaction.id));

  reporter.line(`${session.meta.title}`);
  if (session.meta.description !== undefined) reporter.line(`  ${oneLine(session.meta.description)}`);
  reporter.line(
    `  defaults: identity=${session.defaults.identityMode} results=${session.defaults.resultVisibility} answer-change=${String(session.defaults.allowAnswerChange)}`,
  );
  reporter.line('');

  session.interactions.forEach((interaction, index) => {
    for (const line of previewLines(interaction, index)) reporter.line(line);
    reporter.line(`   participant sees: ${JSON.stringify(views[index])}`);
    reporter.line('');
  });

  reporter.emit({ session, participantViews: views });
  return 0;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Host preview block for a single interaction (exported for tests). */
export function previewLines(interaction: Interaction, index: number): string[] {
  const lines: string[] = [];
  const display = interaction.display ?? '';
  lines.push(`${index + 1}. [${interaction.type}${display === '' ? '' : `/${display}`}] ${interaction.id}`);
  lines.push(`   prompt: ${oneLine(interaction.prompt)}`);

  switch (interaction.type) {
    case 'choice': {
      for (const option of interaction.options) {
        const mark = option.correct === true ? '✓' : ' ';
        let line = `   ${mark} ${option.id}: ${option.label}`;
        if (option.misconception !== undefined) {
          line += `  — misconception: ${oneLine(option.misconception)}`;
        }
        lines.push(line);
      }
      if (interaction.multiple === true) lines.push('   multiple: yes');
      break;
    }
    case 'scale': {
      const min = interaction.minLabel === undefined ? '' : ` (${interaction.minLabel})`;
      const max = interaction.maxLabel === undefined ? '' : ` (${interaction.maxLabel})`;
      lines.push(`   scale: ${interaction.min}${min} .. ${interaction.max}${max}`);
      break;
    }
    case 'numeric': {
      const unit = interaction.unit === undefined ? '' : ` ${interaction.unit}`;
      if (interaction.correct !== undefined) {
        const tol = interaction.tolerance === undefined ? '' : ` ± ${interaction.tolerance}`;
        lines.push(`   correct: ${interaction.correct}${unit}${tol}`);
      } else if (interaction.unit !== undefined) {
        lines.push(`   unit: ${interaction.unit}`);
      }
      break;
    }
    case 'text': {
      if (interaction.maxLength !== undefined) {
        lines.push(`   maxLength: ${interaction.maxLength}`);
      }
      break;
    }
    case 'qna':
      break;
    default:
      break;
  }

  if (interaction.allowDontKnow === true) lines.push(`   "I don't know" answer: enabled`);
  if (interaction.resultVisibility !== undefined) {
    lines.push(`   results: ${interaction.resultVisibility}`);
  }
  if (interaction.pedagogy?.objective !== undefined) {
    lines.push(`   objective: ${oneLine(interaction.pedagogy.objective)}`);
  }
  if (interaction.pedagogy?.durationSec !== undefined) {
    lines.push(`   estimated duration: ${interaction.pedagogy.durationSec}s`);
  }
  if (interaction.timerSec !== undefined) {
    lines.push(`   countdown: ${interaction.timerSec}s (advisory)`);
  }
  if (interaction.notes !== undefined) lines.push(`   notes: ${oneLine(interaction.notes)}`);
  return lines;
}
