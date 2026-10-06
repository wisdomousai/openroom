import type { ErrorObject, ValidateFunction } from 'ajv';
import { parse as parseYaml } from 'yaml';

// Precompiled at build time (scripts/compile-validator.mjs) — Cloudflare Workers
// forbid Ajv's runtime schema compilation (`new Function`), so the validator must
// be eval-free generated code.
import compiledValidator from './generated/validator.js';
import compiledDraftValidator from './generated/draft-validator.js';

import {
  displaysFor,
  MAX_OPTIONS,
  MAX_RANKING_OPTIONS,
  MAX_SCALE_SPAN,
  MIN_OPTIONS,
  MIN_RANKING_OPTIONS,
  MIN_SCALE_SPAN,
} from './schema.js';
import { validateDisplayOptionsShape } from './display-options.js';
import { fillTheGapsPlaceholderPattern } from './fill-the-gaps-match.js';
import { normalizeTextAnswer } from './text-match.js';
import {
  ErrorCodes,
  type Interaction,
  type SessionError,
  type Session,
  type ValidateResult,
} from './types.js';
import { compileSimpleSession, isSimpleSession } from './simple-session.js';

function getValidator(): ValidateFunction {
  return compiledValidator;
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function ajvErrorToSessionError(err: ErrorObject): SessionError {
  let path = err.instancePath === '' ? '/' : err.instancePath;
  if (err.keyword === 'required') {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    if (typeof missing === 'string') {
      path = `${err.instancePath}/${escapePointerToken(missing)}`;
    }
  }
  if (err.keyword === 'additionalProperties' || err.keyword === 'unevaluatedProperties') {
    const extra =
      (err.params as { additionalProperty?: string; unevaluatedProperty?: string })
        .additionalProperty ??
      (err.params as { unevaluatedProperty?: string }).unevaluatedProperty;
    if (typeof extra === 'string') {
      path = `${err.instancePath}/${escapePointerToken(extra)}`;
    }
  }
  return {
    code: ErrorCodes.E_SCHEMA,
    path,
    message: err.message ?? 'schema violation',
  };
}

/**
 * Semantic checks that run after the JSON Schema passes. These produce specific,
 * stable error codes rather than the generic E_SCHEMA.
 */
function semanticErrors(session: Session, draft = false): SessionError[] {
  const errors: SessionError[] = [];
  const seenIds = new Map<string, number>();

  session.interactions.forEach((raw, index) => {
    const interaction = raw as Interaction;
    const base = `/interactions/${index}`;
    if (!draft) {
      const requireText = (text: string, path: string) => {
        if (text.trim() === '') errors.push({ code: ErrorCodes.E_SCHEMA, path, message: 'enter text before starting the session' });
      };
      requireText(interaction.prompt, `${base}/prompt`);
      if (interaction.type === 'choice' || interaction.type === 'ranking') {
        interaction.options.forEach((option, i) => requireText(option.label, `${base}/options/${i}/label`));
      }
      if (interaction.type === 'match') {
        for (const side of ['left', 'right'] as const) interaction[side].forEach((item, i) => requireText(item.label, `${base}/${side}/${i}/label`));
      }
      if (interaction.type === 'fill-the-gaps') {
        interaction.gaps.forEach((gap, i) => gap.answers.forEach((answer, j) => requireText(answer, `${base}/gaps/${i}/answers/${j}`)));
      }
    }

    // -- duplicate interaction ids ------------------------------------
    const firstIndex = seenIds.get(interaction.id);
    if (firstIndex === undefined) {
      seenIds.set(interaction.id, index);
    } else {
      errors.push({
        code: ErrorCodes.E_DUPLICATE_ID,
        path: `${base}/id`,
        message: `duplicate interaction id "${interaction.id}" (first used at /interactions/${firstIndex})`,
      });
    }

    // -- display style must match the interaction type -----------------
    if (interaction.display !== undefined) {
      const allowed = displaysFor(interaction.type);
      if (!allowed.includes(interaction.display)) {
        errors.push({
          code: ErrorCodes.E_DISPLAY_MISMATCH,
          path: `${base}/display`,
          message: `display "${interaction.display}" is not valid for type "${
            interaction.type
          }" (allowed: ${allowed.join(', ')})`,
        });
      }
    }

    // -- displayOptions shape ------------------------------------------
    if (interaction.displayOptions !== undefined) {
      for (const issue of validateDisplayOptionsShape(interaction.displayOptions)) {
        errors.push({
          code: ErrorCodes.E_SCHEMA,
          path: `${base}/displayOptions/${issue.key}`,
          message: issue.message,
        });
      }
    }

    if (interaction.responseMode === 'group' && interaction.type === 'qna') {
      errors.push({ code: ErrorCodes.E_SCHEMA, path: `${base}/responseMode`,
        message: 'Audience Q&A is individual. Use a text question for a shared group response.' });
    }

    // -- peer instruction placement ------------------------------------
    // `peerInstruction` is a vote → discuss → revote cycle over ONE choice, so
    // it is only meaningful on a single-select choice interaction.
    const peerInstruction = (interaction as { peerInstruction?: unknown }).peerInstruction;
    if (peerInstruction === true) {
      const multiple = (interaction as { multiple?: unknown }).multiple === true;
      if (interaction.type !== 'choice') {
        errors.push({
          code: ErrorCodes.E_PEER_INSTRUCTION_CONFIG,
          path: `${base}/peerInstruction`,
          message: `"peerInstruction" is only valid on a choice interaction (got type "${interaction.type}")`,
        });
      } else if (multiple) {
        errors.push({
          code: ErrorCodes.E_PEER_INSTRUCTION_CONFIG,
          path: `${base}/peerInstruction`,
          message: '"peerInstruction" requires a single-select choice ("multiple" must be false or absent)',
        });
      }
    }

    switch (interaction.type) {
      case 'choice': {
        const options = interaction.options;
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
          errors.push({
            code: ErrorCodes.E_OPTION_COUNT,
            path: `${base}/options`,
            message: `choice interaction must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} options, got ${options.length}`,
          });
        }
        const seenOptionIds = new Map<string, number>();
        options.forEach((option, optionIndex) => {
          const first = seenOptionIds.get(option.id);
          if (first === undefined) {
            seenOptionIds.set(option.id, optionIndex);
          } else {
            errors.push({
              code: ErrorCodes.E_DUPLICATE_ID,
              path: `${base}/options/${optionIndex}/id`,
              message: `duplicate option id "${option.id}" in interaction "${interaction.id}"`,
            });
          }
        });
        break;
      }
      case 'ranking': {
        const options = interaction.options;
        if (options.length < MIN_RANKING_OPTIONS || options.length > MAX_RANKING_OPTIONS) {
          errors.push({
            code: ErrorCodes.E_OPTION_COUNT,
            path: `${base}/options`,
            message: `ranking interaction must have between ${MIN_RANKING_OPTIONS} and ${MAX_RANKING_OPTIONS} options, got ${options.length}`,
          });
        }
        const seenOptionIds = new Map<string, number>();
        options.forEach((option, optionIndex) => {
          const first = seenOptionIds.get(option.id);
          if (first === undefined) {
            seenOptionIds.set(option.id, optionIndex);
          } else {
            errors.push({
              code: ErrorCodes.E_DUPLICATE_ID,
              path: `${base}/options/${optionIndex}/id`,
              message: `duplicate option id "${option.id}" in interaction "${interaction.id}"`,
            });
          }
        });
        const correctOrder = interaction.correctOrder;
        if (correctOrder !== undefined) {
          const optionIdSet = new Set(options.map((o) => o.id));
          if (correctOrder.length !== options.length) {
            errors.push({
              code: ErrorCodes.E_CORRECT_ORDER,
              path: `${base}/correctOrder`,
              message: `"correctOrder" must list every option id exactly once (expected ${options.length}, got ${correctOrder.length})`,
            });
          } else {
            const seen = new Set<string>();
            for (let i = 0; i < correctOrder.length; i++) {
              const id = correctOrder[i]!;
              if (!optionIdSet.has(id)) {
                errors.push({
                  code: ErrorCodes.E_CORRECT_ORDER,
                  path: `${base}/correctOrder/${i}`,
                  message: `"correctOrder" references unknown option id "${id}"`,
                });
                break;
              }
              if (seen.has(id)) {
                errors.push({
                  code: ErrorCodes.E_CORRECT_ORDER,
                  path: `${base}/correctOrder/${i}`,
                  message: `"correctOrder" repeats option id "${id}"`,
                });
                break;
              }
              seen.add(id);
            }
          }
        }
        break;
      }
      case 'scale': {
        const span = interaction.max - interaction.min;
        if (span < MIN_SCALE_SPAN || span > MAX_SCALE_SPAN) {
          errors.push({
            code: ErrorCodes.E_SCHEMA,
            path: `${base}/max`,
            message: `scale span (max - min) must be between ${MIN_SCALE_SPAN} and ${MAX_SCALE_SPAN}, got ${span}`,
          });
        }
        break;
      }
      case 'numeric': {
        if (interaction.tolerance !== undefined && interaction.correct === undefined) {
          errors.push({
            code: ErrorCodes.E_TOLERANCE_WITHOUT_CORRECT,
            path: `${base}/tolerance`,
            message: 'numeric "tolerance" requires "correct" to be set',
          });
        }
        break;
      }
      case 'fill-the-gaps': {
        const placeholders = [...interaction.prompt.matchAll(fillTheGapsPlaceholderPattern())].map(
          (match) => match[1]!,
        );
        const gapIds = interaction.gaps.map((gap) => gap.id);
        const placeholderSet = new Set(placeholders);
        const gapSet = new Set(gapIds);
        // Compare *distinct* ids: a prompt that repeats {{g1}} has as many
        // matches as a two-gap prompt, so a length check alone would let the
        // phone render two inputs writing the same key.
        if (placeholderSet.size !== placeholders.length) {
          errors.push({
            code: ErrorCodes.E_FILL_THE_GAPS_GAPS,
            path: `${base}/prompt`,
            message: 'a fill-the-gaps placeholder {{id}} may appear only once in the prompt',
          });
        }
        if (placeholderSet.size !== gapSet.size || gapIds.some((id) => !placeholderSet.has(id))) {
          errors.push({
            code: ErrorCodes.E_FILL_THE_GAPS_GAPS,
            path: `${base}/gaps`,
            message: 'every fill-the-gaps gap must appear once as {{id}} in the prompt',
          });
        }
        const seen = new Set<string>();
        interaction.gaps.forEach((gap, index) => {
          if (seen.has(gap.id)) {
            errors.push({
              code: ErrorCodes.E_DUPLICATE_ID,
              path: `${base}/gaps/${index}/id`,
              message: `duplicate gap id "${gap.id}"`,
            });
          }
          seen.add(gap.id);
          if (!placeholderSet.has(gap.id) && gapSet.has(gap.id)) {
            errors.push({
              code: ErrorCodes.E_FILL_THE_GAPS_GAPS,
              path: `${base}/gaps/${index}/id`,
              message: `gap "${gap.id}" is not referenced in the prompt`,
            });
          }
          const distractors = gap.distractors ?? [];
          const seenDistractors = new Set<string>();
          distractors.forEach((word, distractorIndex) => {
            const key = normalizeTextAnswer(word, interaction.match);
            if (gap.answers.some((answer) => normalizeTextAnswer(answer, interaction.match) === key)) {
              errors.push({
                code: ErrorCodes.E_FILL_THE_GAPS_DISTRACTOR,
                path: `${base}/gaps/${index}/distractors/${String(distractorIndex)}`,
                message: `distractor "${word}" matches an accepted answer of gap "${gap.id}"`,
              });
            }
            if (seenDistractors.has(key)) {
              errors.push({
                code: ErrorCodes.E_FILL_THE_GAPS_DISTRACTOR,
                path: `${base}/gaps/${index}/distractors/${String(distractorIndex)}`,
                message: `duplicate distractor "${word}" on gap "${gap.id}"`,
              });
            }
            seenDistractors.add(key);
          });
        });
        if (interaction.bank !== undefined) {
          const seenBank = new Set<string>();
          interaction.bank.forEach((word, index) => {
            const key = normalizeTextAnswer(word, interaction.match);
            if (seenBank.has(key)) {
              errors.push({
                code: ErrorCodes.E_FILL_THE_GAPS_BANK,
                path: `${base}/bank/${String(index)}`,
                message: `duplicate bank word "${word}"`,
              });
            }
            seenBank.add(key);
          });
        }
        const display = interaction.display ?? 'gaps';
        if (display === 'choices' && !draft) {
          interaction.gaps.forEach((gap, index) => {
            if ((gap.distractors?.length ?? 0) < 1) {
              errors.push({
                code: ErrorCodes.E_FILL_THE_GAPS_CHOICES,
                path: `${base}/gaps/${String(index)}/distractors`,
                message: `choices display requires distractors on gap "${gap.id}"`,
              });
            }
          });
        }
        break;
      }
      case 'match': {
        if (interaction.left.length !== interaction.right.length) {
          errors.push({
            code: ErrorCodes.E_MATCH_PAIRS,
            path: `${base}/right`,
            message: 'match left and right must have the same number of items',
          });
        }
        const leftIds = new Set(interaction.left.map((item) => item.id));
        const rightIds = new Set(interaction.right.map((item) => item.id));
        if (leftIds.size !== interaction.left.length || rightIds.size !== interaction.right.length) {
          errors.push({
            code: ErrorCodes.E_DUPLICATE_ID,
            path: `${base}/left`,
            message: 'match item ids must be unique within each column',
          });
        }
        const correctKeys = Object.keys(interaction.correct);
        if (correctKeys.length !== interaction.left.length) {
          errors.push({
            code: ErrorCodes.E_MATCH_PAIRS,
            path: `${base}/correct`,
            message: 'correct must pair every left item exactly once',
          });
        }
        const usedRights = new Set<string>();
        for (const [leftId, rightId] of Object.entries(interaction.correct)) {
          if (!leftIds.has(leftId)) {
            errors.push({
              code: ErrorCodes.E_MATCH_PAIRS,
              path: `${base}/correct/${leftId}`,
              message: `correct references unknown left id "${leftId}"`,
            });
          }
          if (!rightIds.has(rightId)) {
            errors.push({
              code: ErrorCodes.E_MATCH_PAIRS,
              path: `${base}/correct/${leftId}`,
              message: `correct references unknown right id "${rightId}"`,
            });
          }
          if (usedRights.has(rightId)) {
            errors.push({
              code: ErrorCodes.E_MATCH_PAIRS,
              path: `${base}/correct/${leftId}`,
              message: `right id "${rightId}" is paired more than once`,
            });
          }
          usedRights.add(rightId);
        }
        break;
      }
      default:
        break;
    }
  });

  return errors;
}

/**
 * Validate an unknown value against the Session schema plus semantic rules.
 * SimpleSession documents (`title` + `questions`, no `interactions`) are compiled
 * first, then validated as Session.
 * Never throws.
 */
export function validateSession(input: unknown): ValidateResult {
  let candidate = input;
  if (isSimpleSession(input)) {
    const compiled = compileSimpleSession(input);
    if (!compiled.ok) return compiled;
    candidate = compiled.session;
  }

  const validator = getValidator();
  const valid = validator(candidate);
  if (!valid) {
    const ajvErrors = validator.errors ?? [];
    const errors = ajvErrors.map(ajvErrorToSessionError);
    return {
      ok: false,
      errors: errors.length > 0 ? errors : [{ code: ErrorCodes.E_SCHEMA, path: '/', message: 'invalid session' }],
    };
  }
  const session = candidate as Session;
  const errors = semanticErrors(session);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, session };
}

/** Internal saved-deck validation. Never use this to admit live questions. */
export function validateDraftSession(input: unknown): ValidateResult {
  const validator = compiledDraftValidator as ValidateFunction;
  if (!validator(input)) return { ok: false, errors: (validator.errors ?? []).map(ajvErrorToSessionError) };
  const session = input as Session;
  const errors = semanticErrors(session, true);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, session };
}

/**
 * Parse YAML or JSON text (the `yaml` package handles both, since JSON is a YAML
 * subset) and validate the result. `format` is accepted for explicitness but the
 * parser is the same either way, except that `format: 'json'` uses JSON.parse for
 * stricter errors.
 */
export function parseSession(text: string, format?: 'yaml' | 'json'): ValidateResult {
  let data: unknown;
  try {
    data = format === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          code: ErrorCodes.E_PARSE,
          path: '/',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  if (data === null || data === undefined) {
    return {
      ok: false,
      errors: [{ code: ErrorCodes.E_PARSE, path: '/', message: 'document is empty' }],
    };
  }
  return validateSession(data);
}
