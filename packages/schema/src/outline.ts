import type { ErrorObject, ValidateFunction } from 'ajv';
import { parse as parseYaml } from 'yaml';

import compiledOutlineValidator from './generated/outline-validator.js';
import type {
  CompiledOutline,
  LearnerOutlineStep,
  Outline,
  OutlineStep,
  OutlineValidateResult,
} from './outline-types.js';
import { OUTLINE_STEP_KINDS } from './outline-types.js';
import { outlineSchema } from './outline-schema.js';
import { ErrorCodes, type SessionError, type Session } from './types.js';
import { compileSimpleSession, isSimpleSession } from './simple-session.js';
import { validateDraftSession, validateSession } from './validate.js';
import { stripDeprecatedOutlineFields } from './normalize.js';
import { isHomeworkQuizType } from './homework.js';
import { elementMarkupIssue } from './element-html.js';
import { iframeUrlIssue, pdfUrlIssue } from './element-iframe.js';
import {
  kindCanCarryElements,
  layoutAllowedForKind,
  LAYOUTS_FOR_KIND,
  LIST_SPANS_FOR_KIND,
  partKeysForStep,
  revealIssues,
  SLOT_SPANS_FOR_KIND,
  stepElements,
} from './outline-parts.js';

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function schemaError(err: ErrorObject): SessionError {
  let path = err.instancePath === '' ? '/' : err.instancePath;
  if (err.keyword === 'required') {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    if (typeof missing === 'string') path = `${err.instancePath}/${escapePointerToken(missing)}`;
  }
  if (err.keyword === 'additionalProperties' || err.keyword === 'unevaluatedProperties') {
    const params = err.params as {
      additionalProperty?: string;
      unevaluatedProperty?: string;
    };
    const extra = params.additionalProperty ?? params.unevaluatedProperty;
    if (typeof extra === 'string') path = `${err.instancePath}/${escapePointerToken(extra)}`;
  }
  return { code: ErrorCodes.E_SCHEMA, path, message: err.message ?? 'schema violation' };
}

function semanticErrors(outline: Outline): SessionError[] {
  const errors: SessionError[] = [];
  const stepIds = new Map<string, number>();
  const interactionIds = new Set(outline.interactions.map((interaction) => interaction.id));
  const masterIds = new Set<string>();
  for (const [index, master] of (outline.design?.masters ?? []).entries()) {
    if (masterIds.has(master.id)) errors.push({ code: ErrorCodes.E_DUPLICATE_ID, path: `/design/masters/${index}/id`, message: 'duplicate master id' });
    masterIds.add(master.id);
  }
  if (outline.design && !masterIds.has(outline.design.defaultMasterId)) {
    errors.push({ code: ErrorCodes.E_UNKNOWN_REFERENCE, path: '/design/defaultMasterId', message: 'unknown default master' });
  }

  outline.steps.forEach((step, index) => {
    if (step.design?.masterId && !masterIds.has(step.design.masterId)) {
      errors.push({ code: ErrorCodes.E_UNKNOWN_REFERENCE, path: `/steps/${index}/design/masterId`, message: 'unknown slide master' });
    }
    const first = stepIds.get(step.id);
    if (first === undefined) {
      stepIds.set(step.id, index);
    } else {
      errors.push({
        code: ErrorCodes.E_DUPLICATE_ID,
        path: `/steps/${index}/id`,
        message: `duplicate outline step id "${step.id}" (first used at /steps/${first})`,
      });
    }

    if (step.kind === 'interaction' && !interactionIds.has(step.interactionId)) {
      errors.push({
        code: ErrorCodes.E_UNKNOWN_REFERENCE,
        path: `/steps/${index}/interactionId`,
        message: `outline step references unknown interaction id "${step.interactionId}"`,
      });
    }

    // -- layout must be one the kind can fill ---------------------------
    if (step.layout !== undefined && !layoutAllowedForKind(step.kind, step.layout)) {
      errors.push({
        code: ErrorCodes.E_LAYOUT_MISMATCH,
        path: `/steps/${index}/layout`,
        message: `layout "${step.layout}" is not valid for step "${step.id}" of kind "${
          step.kind
        }" (allowed: ${LAYOUTS_FOR_KIND[step.kind].join(', ')})`,
      });
    }

    // -- reveal names real parts, each at most once ---------------------
    for (const issue of revealIssues(step, outline.interactions)) {
      errors.push({
        code: ErrorCodes.E_REVEAL,
        path: issue.group < 0 ? `/steps/${index}/reveal` : `/steps/${index}/reveal/${issue.group}`,
        message: issue.message,
      });
    }

    // -- styled spans on the step's own fixed slots ----------------------
    for (const slot of SLOT_SPANS_FOR_KIND[step.kind]) {
      const fields = step as unknown as Record<string, unknown>;
      const spans = fields[slot.spansField];
      if (spans === undefined) continue;
      const text = fields[slot.textField];
      const issue = spansConcatIssue(
        typeof text === 'string' ? text : undefined,
        spans as { text: string }[],
      );
      if (issue !== null) {
        errors.push({
          code: ErrorCodes.E_SCHEMA,
          path: `/steps/${index}/${slot.spansField}`,
          message: issue,
        });
      }
    }

    // -- styled spans on repeated text: cards carry their own, string lists a
    //    parallel SpanRows mirror ------------------------------------------
    if (step.kind === 'cards') {
      step.items.forEach((card, cardIndex) => {
        const issue = spansConcatIssue(card.text, card.textSpans);
        if (issue !== null) {
          errors.push({
            code: ErrorCodes.E_SCHEMA,
            path: `/steps/${index}/items/${cardIndex}/textSpans`,
            message: issue,
          });
        }
      });
    }
    for (const mirror of LIST_SPANS_FOR_KIND[step.kind] ?? []) {
      const fields = step as unknown as Record<string, unknown>;
      const rows = fields[mirror.spansField];
      if (rows === undefined) continue;
      const list = fields[mirror.listField];
      const lines = Array.isArray(list) ? (list as string[]) : [];
      const entries = rows as ({ text: string }[] | null)[];
      if (entries.length > lines.length) {
        errors.push({
          code: ErrorCodes.E_SCHEMA,
          path: `/steps/${index}/${mirror.spansField}`,
          message: `${mirror.spansField} has ${entries.length} rows but ${mirror.listField} has ${lines.length} lines`,
        });
        continue;
      }
      entries.forEach((entry, row) => {
        if (entry === null) return;
        const issue = spansConcatIssue(lines[row], entry);
        if (issue !== null) {
          errors.push({
            code: ErrorCodes.E_SCHEMA,
            path: `/steps/${index}/${mirror.spansField}/${row}`,
            message: issue,
          });
        }
      });
    }

    if ('elements' in step && step.elements !== undefined && !kindCanCarryElements(step.kind)) {
      errors.push({
        code: ErrorCodes.E_SCHEMA,
        path: `/steps/${index}/elements`,
        message: `step "${step.id}" of kind "${step.kind}" cannot carry freeform elements`,
      });
    }

    const seenElements = new Set<string>();
    stepElements(step).forEach((element, elementIndex) => {
      const path = `/steps/${index}/elements/${elementIndex}`;
      if (seenElements.has(element.id)) {
        errors.push({
          code: ErrorCodes.E_DUPLICATE_ID,
          path: `${path}/id`,
          message: `duplicate element id "${element.id}" on step "${step.id}"`,
        });
      }
      seenElements.add(element.id);
      if (element.type === 'html') {
        const issue = elementMarkupIssue(element.html, element.css, element.markdown);
        if (issue !== null) {
          errors.push({ code: ErrorCodes.E_SCHEMA, path: `${path}/html`, message: issue });
        }
      }
      if (element.type === 'text' && element.spans !== undefined) {
        const issue = spansConcatIssue(element.text, element.spans);
        if (issue !== null) {
          errors.push({ code: ErrorCodes.E_SCHEMA, path: `${path}/spans`, message: issue });
        }
      }
      if (element.type === 'iframe') {
        const issue = iframeUrlIssue(element.url);
        if (issue !== null) {
          errors.push({ code: ErrorCodes.E_SCHEMA, path: `${path}/url`, message: issue });
        }
      }
      if (element.type === 'pdf') {
        if (element.url !== undefined) {
          const issue = pdfUrlIssue(element.url);
          if (issue !== null) {
            errors.push({ code: ErrorCodes.E_SCHEMA, path: `${path}/url`, message: issue });
          }
        }
      }
    });
  });

  outline.interactions.forEach((interaction, index) => {
    // -- option labels mirror their spans the same way slots do ------------
    const labelled: { path: string; items: readonly { label: string; labelSpans?: { text: string }[] }[] }[] = [];
    if (interaction.type === 'choice' || interaction.type === 'ranking') {
      labelled.push({ path: 'options', items: interaction.options });
    }
    if (interaction.type === 'match') {
      labelled.push({ path: 'left', items: interaction.left }, { path: 'right', items: interaction.right });
    }
    for (const list of labelled) {
      list.items.forEach((option, optionIndex) => {
        const issue = spansConcatIssue(option.label, option.labelSpans);
        if (issue !== null) {
          errors.push({
            code: ErrorCodes.E_SCHEMA,
            path: `/interactions/${index}/${list.path}/${optionIndex}/labelSpans`,
            message: issue,
          });
        }
      });
    }

    if (interaction.promptSpans === undefined) return;
    if (interaction.type === 'fill-the-gaps') {
      errors.push({
        code: ErrorCodes.E_SCHEMA,
        path: `/interactions/${index}/promptSpans`,
        message:
          'a fill-the-gaps prompt holds {{id}} placeholders and cannot carry styled spans — promptFont is its one style',
      });
      return;
    }
    const issue = spansConcatIssue(interaction.prompt, interaction.promptSpans);
    if (issue !== null) {
      errors.push({
        code: ErrorCodes.E_SCHEMA,
        path: `/interactions/${index}/promptSpans`,
        message: issue,
      });
    }
  });

  errors.push(...breakoutErrors(outline));
  errors.push(...homeworkErrors(outline));

  return errors;
}

const HOMEWORK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Spans must describe exactly the plain text beside them: same characters, in
 * order, nothing empty. Styling values are already schema-checked (size range,
 * hex color, family enum); this is the invariant Ajv cannot see — that the two
 * representations of one string agree.
 */
function spansConcatIssue(text: string | undefined, spans?: readonly { text: string }[]): string | null {
  if (spans === undefined) return null;
  if (text === undefined) return 'spans are present but the text they style is not';
  if (spans.some((span) => span.text.length === 0)) return 'spans contain an empty span';
  const concatenated = spans.map((span) => span.text).join('');
  if (concatenated !== text) {
    return `spans concatenate to ${concatenated.length} characters but text is ${text.length}`;
  }
  return null;
}


function homeworkErrors(outline: Outline): SessionError[] {
  const errors: SessionError[] = [];
  const tasks = outline.homework?.tasks;
  if (tasks === undefined) return errors;
  const seen = new Map<string, number>();
  const interactionIds = new Set(outline.interactions.map((interaction) => interaction.id));
  const byId = new Map(outline.interactions.map((interaction) => [interaction.id, interaction]));

  tasks.forEach((task, index) => {
    const path = `/homework/tasks/${index}`;
    if (!HOMEWORK_ID.test(task.id)) {
      errors.push({
        code: ErrorCodes.E_SCHEMA,
        path: `${path}/id`,
        message: `homework task id "${task.id}" must be kebab-case`,
      });
    }
    const first = seen.get(task.id);
    if (first === undefined) {
      seen.set(task.id, index);
    } else {
      errors.push({
        code: ErrorCodes.E_DUPLICATE_ID,
        path: `${path}/id`,
        message: `duplicate homework task id "${task.id}" (first used at /homework/tasks/${first})`,
      });
    }
    if (task.kind !== 'quiz') return;
    if (!interactionIds.has(task.interactionId)) {
      errors.push({
        code: ErrorCodes.E_UNKNOWN_REFERENCE,
        path: `${path}/interactionId`,
        message: `homework quiz references unknown interaction id "${task.interactionId}"`,
      });
      return;
    }
    const interaction = byId.get(task.interactionId);
    if (interaction === undefined) return;
    if (!isHomeworkQuizType(interaction.type)) {
      errors.push({
        code: ErrorCodes.E_SCHEMA,
        path: `${path}/interactionId`,
        message: `homework quiz "${task.id}" cannot use a ${interaction.type} interaction`,
      });
      return;
    }
    if (interaction.type === 'ranking' && interaction.correctOrder === undefined) {
      errors.push({
        code: ErrorCodes.E_CORRECT_ORDER,
        path: `${path}/interactionId`,
        message: `homework quiz "${task.id}" points at a ranking with no correctOrder`,
      });
    }
  });
  return errors;
}

/** Follow the breakoutOf chain from `step`; true if it ever revisits a step. */
function inBreakoutCycle(step: OutlineStep, stepById: Map<string, OutlineStep>): boolean {
  const seen = new Set<string>();
  let current: OutlineStep | undefined = step;
  while (current?.breakoutOf !== undefined) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = stepById.get(current.breakoutOf.stepId);
    if (current !== undefined && seen.has(current.id)) return true;
  }
  return false;
}

/**
 * `breakoutOf` rules: the parent exists, `afterKey` is a part of *that* parent,
 * the chain is one level deep, and nothing points at itself or back round.
 */
function breakoutErrors(outline: Outline): SessionError[] {
  const errors: SessionError[] = [];
  const stepById = new Map(outline.steps.map((step) => [step.id, step]));

  outline.steps.forEach((step, index) => {
    const breakout = step.breakoutOf;
    if (breakout === undefined) return;
    const path = `/steps/${index}/breakoutOf`;

    // Cycle first, so A -> B -> A reports as a cycle rather than as depth.
    if (inBreakoutCycle(step, stepById)) {
      errors.push({
        code: ErrorCodes.E_BREAKOUT,
        path: `${path}/stepId`,
        message: `breakout step "${step.id}" is part of a breakout cycle through "${breakout.stepId}"`,
      });
      return;
    }

    const parent = stepById.get(breakout.stepId);
    if (parent === undefined) {
      errors.push({
        code: ErrorCodes.E_UNKNOWN_REFERENCE,
        path: `${path}/stepId`,
        message: `breakout step "${step.id}" attaches to unknown step id "${breakout.stepId}"`,
      });
      return;
    }

    if (parent.breakoutOf !== undefined) {
      errors.push({
        code: ErrorCodes.E_BREAKOUT,
        path: `${path}/stepId`,
        message: `breakout step "${step.id}" attaches to "${parent.id}", which is itself a breakout — breakouts are one level only`,
      });
      return;
    }

    const parentParts = partKeysForStep(parent, outline.interactions);
    if (!parentParts.includes(breakout.afterKey)) {
      errors.push({
        code: ErrorCodes.E_BREAKOUT,
        path: `${path}/afterKey`,
        message: `breakout step "${step.id}" attaches after part "${
          breakout.afterKey
        }", which step "${parent.id}" does not have (parts: ${parentParts.join(', ')})`,
      });
    }
  });

  return errors;
}

/** Interaction slice of an outline — used by the live runtime, not a standalone document. */
export function toSession(outline: Outline): Session {
  return {
    version: 1,
    meta: {
      title: outline.meta.title,
      ...(outline.meta.description === undefined ? {} : { description: outline.meta.description }),
      ...(outline.meta.locale === undefined ? {} : { locale: outline.meta.locale }),
      ...(outline.meta.source === undefined ? {} : { source: outline.meta.source }),
    },
    ...(outline.defaults === undefined ? {} : { defaults: outline.defaults }),
    ...(outline.qna === undefined ? {} : { qna: outline.qna }),
    interactions: outline.interactions,
  };
}

export function isOutlineDocument(input: unknown): input is Outline {
  return (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Array.isArray((input as { steps?: unknown }).steps)
  );
}

/**
 * Classroom poll lists (interactions, no steps) compile to an outline of
 * interaction steps. Same file the deck editor stores.
 */
export function outlineFromSession(session: Session): Outline {
  return {
    version: 1,
    meta: {
      title: session.meta.title,
      ...(session.meta.description === undefined ? {} : { description: session.meta.description }),
      ...(session.meta.locale === undefined ? {} : { locale: session.meta.locale }),
      ...(session.meta.source === undefined ? {} : { source: session.meta.source }),
    },
    ...(session.defaults === undefined ? {} : { defaults: session.defaults }),
    ...(session.qna === undefined ? {} : { qna: session.qna }),
    steps: session.interactions.map((interaction) => ({
      id: interaction.id,
      kind: 'interaction' as const,
      interactionId: interaction.id,
    })),
    interactions: session.interactions,
  };
}

/**
 * Ingest path for starting a live session: Outline v1, SimpleSession, or a
 * poll list (interactions without steps). Always returns an Outline.
 */
export function compileToOutline(input: unknown): OutlineValidateResult {
  if (isSimpleSession(input)) {
    const compiled = compileSimpleSession(input);
    if (!compiled.ok) return compiled;
    return compileOutline(outlineFromSession(compiled.session));
  }
  if (isOutlineDocument(input)) return compileOutline(input);
  const sessionResult = validateSession(input);
  if (!sessionResult.ok) return sessionResult;
  return validateOutline(outlineFromSession(sessionResult.session));
}

/* ------------------------------------------------------------------ */
/* Step-union error pruning                                            */
/* ------------------------------------------------------------------ */

/**
 * `$defs.step` is a `oneOf` over 13 branches, each `allOf: [$ref stepBase,
 * {kind: {const}}]` with `unevaluatedProperties: false`, compiled with
 * `allErrors`. So one wrong step makes Ajv report every branch's required
 * fields against it — 72 errors for a single unrecognised `kind`, of which at
 * most a couple describe the step the author actually wrote. Every surface
 * truncates the list (the deck editor shows 5, the desktop editor and MCP host show 3),
 * so the real cause is not merely buried, it is cut off entirely.
 *
 * Ajv cannot be made to prune this itself: `discriminator` is an instance-wide
 * option (the session schema shares the instance) and it rejects `oneOf`
 * branches that are `$ref`s without an inline `properties.kind.const`, which is
 * exactly how all 13 branches are written. The standalone validator also
 * reports `schemaPath` relative to each subschema (`#/allOf/1/required`), so
 * the branch a given error came from is not recoverable from the error itself.
 *
 * What is recoverable is which branch the author *meant* — `kind` says so. This
 * table, read from the normative schema rather than restated from it, is enough
 * to tell that branch's errors from the other twelve's.
 */
interface StepBranch {
  required: ReadonlySet<string>;
  allowed: ReadonlySet<string>;
}

const STEP_BRANCHES: ReadonlyMap<string, StepBranch> = (() => {
  const defs = (outlineSchema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const stepBase = defs['stepBase'] ?? {};
  const baseRequired = (stepBase['required'] as string[] | undefined) ?? [];
  const baseAllowed = Object.keys((stepBase['properties'] as object | undefined) ?? {});
  const branches = new Map<string, StepBranch>();
  for (const kind of OUTLINE_STEP_KINDS) {
    const def = defs[`${kind}Step`] ?? {};
    const parts = (def['allOf'] as Record<string, unknown>[] | undefined) ?? [];
    // The branch's own half of the allOf — the one carrying kind/const and the
    // kind-specific fields, as opposed to the `$ref` to stepBase.
    const own = parts.find((part) => part['properties'] !== undefined || part['required'] !== undefined) ?? {};
    branches.set(kind, {
      required: new Set([...baseRequired, ...((own['required'] as string[] | undefined) ?? [])]),
      allowed: new Set([...baseAllowed, ...Object.keys((own['properties'] as object | undefined) ?? {})]),
    });
  }
  return branches;
})();

/** The `kind` an author wrote at `/steps/<index>`, or undefined if unusable. */
function authoredKind(input: unknown, index: number): string | undefined {
  const steps = (input as { steps?: unknown[] } | undefined)?.steps;
  if (!Array.isArray(steps)) return undefined;
  const kind = (steps[index] as { kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' ? kind : undefined;
}

/** Index of the step an error sits on or under, or null if it is elsewhere. */
function stepIndexOf(instancePath: string): number | null {
  const match = /^\/steps\/(\d+)(?=\/|$)/.exec(instancePath);
  if (match === null) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

/**
 * Drop the errors belonging to branches the author did not choose. Errors
 * outside `/steps` pass through untouched, and a step whose `kind` names no
 * branch collapses to one `E_UNKNOWN_KIND` naming the kinds that exist.
 */
function pruneStepUnionErrors(errors: readonly ErrorObject[], input: unknown): SessionError[] {
  const kept: SessionError[] = [];
  const seen = new Set<string>();
  const reportedUnknownKind = new Set<number>();

  for (const err of errors) {
    const index = stepIndexOf(err.instancePath);
    if (index === null) {
      kept.push(schemaError(err));
      continue;
    }

    const kind = authoredKind(input, index);
    const branch = kind === undefined ? undefined : STEP_BRANCHES.get(kind);
    if (branch === undefined) {
      if (reportedUnknownKind.has(index)) continue;
      reportedUnknownKind.add(index);
      kept.push({
        code: ErrorCodes.E_UNKNOWN_KIND,
        path: `/steps/${String(index)}/kind`,
        message:
          kind === undefined
            ? `outline step is missing "kind" (one of: ${OUTLINE_STEP_KINDS.join(', ')})`
            : `unknown outline step kind "${kind}" (one of: ${OUTLINE_STEP_KINDS.join(', ')})`,
      });
      continue;
    }

    const rest = err.instancePath.slice(`/steps/${String(index)}`.length);
    if (rest === '') {
      // `oneOf` only ever says "none of the 13 matched", which the surviving
      // branch error already says specifically. A failed `kind` const is the
      // other twelve branches announcing they are not this step.
      if (err.keyword === 'oneOf') continue;
      if (err.keyword === 'required') {
        const missing = (err.params as { missingProperty?: string }).missingProperty;
        if (typeof missing === 'string' && !branch.required.has(missing)) continue;
      }
      if (err.keyword === 'unevaluatedProperties' || err.keyword === 'additionalProperties') {
        const params = err.params as { unevaluatedProperty?: string; additionalProperty?: string };
        const extra = params.unevaluatedProperty ?? params.additionalProperty;
        if (typeof extra === 'string' && branch.allowed.has(extra)) continue;
      }
    } else {
      if (err.keyword === 'const' && rest === '/kind') continue;
      // A complaint about a field this kind does not have came from some other
      // branch; one about a field it does (however deep) is the author's.
      const field = rest.split('/')[1];
      if (field !== undefined && !branch.allowed.has(field)) continue;
    }

    const mapped = schemaError(err);
    const key = `${mapped.code}|${mapped.path}|${mapped.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(mapped);
  }

  return kept;
}

/** Validate an Outline. Interactions are checked against the shared interaction defs. */
export function validateOutline(rawInput: unknown): OutlineValidateResult {
  // Withdrawn fields are dropped, never rejected: stored outlines carrying them
  // must keep validating. See DEPRECATED_OUTLINE_STEP_KEYS in normalize.ts.
  const input = stripDeprecatedOutlineFields(rawInput);
  const validator = compiledOutlineValidator as ValidateFunction;
  if (!validator(input)) {
    const errors = pruneStepUnionErrors(validator.errors ?? [], input);
    return {
      ok: false,
      errors: errors.length > 0 ? errors : [{ code: ErrorCodes.E_SCHEMA, path: '/', message: 'invalid outline' }],
    };
  }

  const outline = input as Outline;
  const semantics = semanticErrors(outline);
  if (semantics.length > 0) return { ok: false, errors: semantics };

  const sessionResult = validateDraftSession(toSession(outline));
  if (!sessionResult.ok) return sessionResult;
  return { ok: true, outline, session: sessionResult.session };
}

/** Compile for a live session: saved draft content must now be complete. */
export function compileOutline(input: unknown): OutlineValidateResult {
  const result = validateOutline(input);
  if (!result.ok) return result;
  const live = validateSession(result.session);
  return live.ok ? { ...result, session: live.session } : live;
}

export function parseOutline(text: string, format?: 'yaml' | 'json'): OutlineValidateResult {
  let data: unknown;
  try {
    data = format === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: ErrorCodes.E_PARSE,
        path: '/',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  if (data === null || data === undefined) {
    return {
      ok: false,
      errors: [{ code: ErrorCodes.E_PARSE, path: '/', message: 'document is empty' }],
    };
  }
  return validateOutline(data);
}

/** Parse YAML/JSON text, then compile SimpleSession / poll lists / Outline to Outline. */
export function parseStartOutline(text: string, format?: 'yaml' | 'json'): OutlineValidateResult {
  let data: unknown;
  try {
    data = format === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: ErrorCodes.E_PARSE,
        path: '/',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  if (data === null || data === undefined) {
    return {
      ok: false,
      errors: [{ code: ErrorCodes.E_PARSE, path: '/', message: 'document is empty' }],
    };
  }
  return compileToOutline(data);
}

/** Strip tutor-only material before an outline step is sent to a learner or shared stage. */
export function projectOutlineStep(step: OutlineStep, listening?: { mode: 'room' | 'individual'; transcriptShown: boolean }): LearnerOutlineStep {
  const { tutorNotes: _private, ...safe } = step;
  if ('media' in safe && safe.media?.listening) {
    const authored = safe.media.listening;
    return { ...safe, media: { ...safe.media, listening: {
      mode: listening?.mode ?? authored.mode,
      ...(listening?.transcriptShown && authored.transcript ? { transcript: authored.transcript } : {}),
    } } } as LearnerOutlineStep;
  }
  return safe;
}

export function projectOutlineSteps(outline: Outline): LearnerOutlineStep[] {
  return outline.steps.map((step) => projectOutlineStep(step));
}

export function asCompiledOutline(result: OutlineValidateResult): CompiledOutline | null {
  return result.ok && validateSession(result.session).ok ? { outline: result.outline, session: result.session } : null;
}
