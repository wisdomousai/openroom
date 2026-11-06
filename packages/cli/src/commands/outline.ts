import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseOutline, resolveRevealOrder } from '@openroom/schema';

import { UsageError, type ParsedArgs } from '../args.js';
import { CliError, Reporter } from '../output.js';

/** Validate the typed outline contract locally before saving it through API or MCP. */
export function cmdOutline(args: ParsedArgs, reporter: Reporter, cwd = process.cwd()): number {
  const sub = args.positionals[1];
  const file = args.positionals[2];
  if (sub !== 'validate' || file === undefined) {
    throw new UsageError('usage: openroom outline validate <file>');
  }
  const path = resolve(cwd, file);
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new CliError(`cannot read outline file: ${path}`, { code: 'E_FILE', path });
  }
  const result = parseOutline(source);
  if (!result.ok) {
    for (const error of result.errors) {
      reporter.errorLine(`${error.code} ${error.path} ${error.message}`);
    }
    reporter.emit({ ok: false, errors: result.errors });
    return 1;
  }
  const value = {
    ok: true,
    title: result.outline.meta.title,
    stepCount: result.outline.steps.length,
    interactionCount: result.session.interactions.length,
    steps: result.outline.steps.map((step, index) => ({
      id: step.id,
      kind: step.kind,
      ...(result.layouts?.[index] === undefined ? {} : { layout: result.layouts[index] }),
      ...(step.reveal === undefined ? {} : { reveal: resolveRevealOrder(step, result.outline.interactions) }),
      ...(step.breakoutOf === undefined ? {} : { breakoutOf: step.breakoutOf }),
    })),
    warnings: result.warnings ?? [],
  };
  reporter.line(
    `✓ valid outline (${String(value.stepCount)} steps, ${String(value.interactionCount)} interactions)`,
  );
  // Warnings are advice about how the outline will draw; the file is still valid.
  for (const warning of value.warnings) {
    reporter.errorLine(`${warning.code} ${warning.path} ${warning.message}`);
  }
  reporter.emit(value);
  return 0;
}
