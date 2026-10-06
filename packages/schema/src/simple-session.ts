/**
 * SimpleSession — default authoring dialect.
 *
 * Humans and agents write title + questions. The compiler expands to an
 * Outline of interaction steps (the same file a deck stores). Advanced knobs
 * (peerInstruction, ranking, qna, pedagogy, custom displays) are authored
 * on the outline's interactions array.
 */

import { defaultDisplay } from './schema.js';
import {
  ErrorCodes,
  type ChoiceDisplay,
  type ChoiceInteraction,
  type Interaction,
  type NumericInteraction,
  type SessionError,
  type ScaleDisplay,
  type ScaleInteraction,
  type Session,
  type TextDisplay,
  type TextInteraction,
  type ValidateResult,
} from './types.js';

export type SimpleQuestionType = 'choice' | 'scale' | 'numeric' | 'text' | 'word-cloud';

export interface SimpleQuestion {
  prompt: string;
  type?: SimpleQuestionType;
  /** Bare strings, or { label, correct? }. Implies choice when type omitted. */
  options?: Array<string | { label: string; correct?: boolean }>;
  /** Mark the choice option whose label matches (case-sensitive trim). */
  correct?: string;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  unit?: string;
  /** Numeric correct value. */
  value?: number;
  tolerance?: number;
  maxLength?: number;
  correctAnswers?: string[];
  /** Stage display override (e.g. word-cloud on a text question). */
  display?: string;
}

export interface SimpleSession {
  title: string;
  questions: SimpleQuestion[];
}

const SIMPLE_TYPES = new Set<SimpleQuestionType>(['choice', 'scale', 'numeric', 'text', 'word-cloud']);
const ALLOWED_QUESTION_KEYS = new Set([
  'prompt',
  'type',
  'options',
  'correct',
  'min',
  'max',
  'minLabel',
  'maxLabel',
  'unit',
  'value',
  'tolerance',
  'maxLength',
  'correctAnswers',
  'display',
]);
const ALLOWED_ROOT_KEYS = new Set(['title', 'questions']);

function err(path: string, message: string, code = ErrorCodes.E_SCHEMA): SessionError {
  return { code, path, message };
}

/** True when the document looks like SimpleSession (not a Session). */
export function isSimpleSession(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const obj = input as Record<string, unknown>;
  if (Array.isArray(obj['interactions'])) return false;
  return Array.isArray(obj['questions']);
}

function slugId(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  used.add(id);
  return id;
}

function optionId(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : `opt-${index + 1}`;
}

/**
 * Compile a SimpleSession object into the interaction slice of an Outline.
 * `compileToOutline` wraps this as interaction steps and validates the outline.
 */
export function compileSimpleSession(input: unknown): ValidateResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [err('/', 'SimpleSession must be an object with title and questions')],
    };
  }
  const root = input as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      return {
        ok: false,
        errors: [
          err(
            `/${key}`,
            `unknown SimpleSession field "${key}" (allowed: title, questions). Use Outline v1 for advanced features`,
          ),
        ],
      };
    }
  }

  const title = root['title'];
  if (typeof title !== 'string' || title.trim() === '') {
    return {
      ok: false,
      errors: [err('/title', 'title is required (non-empty string)')],
    };
  }

  const questions = root['questions'];
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      ok: false,
      errors: [err('/questions', 'questions must be a non-empty array')],
    };
  }

  const usedIds = new Set<string>();
  const interactions: Interaction[] = [];
  const errors: SessionError[] = [];

  questions.forEach((raw, index) => {
    const base = `/questions/${index}`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(err(base, 'each question must be an object'));
      return;
    }
    const q = raw as Record<string, unknown>;
    for (const key of Object.keys(q)) {
      if (!ALLOWED_QUESTION_KEYS.has(key)) {
        errors.push(
          err(
            `${base}/${key}`,
            `unknown field "${key}". Use Outline v1 for advanced features (peerInstruction, ranking, qna, display, notes, pedagogy)`,
          ),
        );
      }
    }

    const prompt = q['prompt'];
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      errors.push(err(`${base}/prompt`, 'prompt is required'));
      return;
    }

    let type = q['type'] as SimpleQuestionType | undefined;
    const options = q['options'];
    if (type === undefined) {
      type = Array.isArray(options) ? 'choice' : undefined;
    }
    if (type === undefined) {
      errors.push(
        err(
          base,
          'set type (choice|scale|numeric|text|word-cloud) or provide options for a choice question',
        ),
      );
      return;
    }
    if (!SIMPLE_TYPES.has(type)) {
      errors.push(
        err(
          `${base}/type`,
          `type must be choice, scale, numeric, text, or word-cloud (got "${String(type)}"). ranking/qna need Outline v1`,
        ),
      );
      return;
    }

    const id = uniqueId(slugId(prompt, `q${index + 1}`), usedIds);
    const asWordCloud = type === 'word-cloud';
    if (asWordCloud) type = 'text';

    if (type === 'choice') {
      if (!Array.isArray(options) || options.length < 2) {
        errors.push(err(`${base}/options`, 'choice questions need at least 2 options'));
        return;
      }
      const correctLabel =
        typeof q['correct'] === 'string' ? (q['correct'] as string).trim() : undefined;
      const choiceOptions = options.map((opt, oi) => {
        if (typeof opt === 'string') {
          const label = opt.trim();
          return {
            id: optionId(oi),
            label,
            ...(correctLabel !== undefined && label === correctLabel ? { correct: true as const } : {}),
          };
        }
        if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
          const o = opt as Record<string, unknown>;
          const label = typeof o['label'] === 'string' ? o['label'].trim() : '';
          const correct =
            o['correct'] === true ||
            (correctLabel !== undefined && label === correctLabel) ||
            undefined;
          return {
            id: optionId(oi),
            label,
            ...(correct ? { correct: true as const } : {}),
          };
        }
        return { id: optionId(oi), label: '' };
      });
      if (choiceOptions.some((o) => o.label === '')) {
        errors.push(err(`${base}/options`, 'every option needs a non-empty label'));
        return;
      }
      const interaction: ChoiceInteraction = {
        id,
        type: 'choice',
        prompt: prompt.trim(),
        display: defaultDisplay('choice') as ChoiceDisplay,
        options: choiceOptions,
      };
      interactions.push(interaction);
      return;
    }

    if (type === 'scale') {
      const min = q['min'];
      const max = q['max'];
      if (typeof min !== 'number' || typeof max !== 'number') {
        errors.push(err(base, 'scale questions require numeric min and max'));
        return;
      }
      const interaction: ScaleInteraction = {
        id,
        type: 'scale',
        prompt: prompt.trim(),
        display: defaultDisplay('scale') as ScaleDisplay,
        min,
        max,
        ...(typeof q['minLabel'] === 'string' ? { minLabel: q['minLabel'] } : {}),
        ...(typeof q['maxLabel'] === 'string' ? { maxLabel: q['maxLabel'] } : {}),
      };
      interactions.push(interaction);
      return;
    }

    if (type === 'numeric') {
      const interaction: NumericInteraction = {
        id,
        type: 'numeric',
        prompt: prompt.trim(),
        display: defaultDisplay('numeric') as 'histogram',
        ...(typeof q['unit'] === 'string' ? { unit: q['unit'] } : {}),
        ...(typeof q['value'] === 'number'
          ? { correct: q['value'] as number }
          : typeof q['correct'] === 'number'
            ? { correct: q['correct'] as number }
            : {}),
        ...(typeof q['tolerance'] === 'number' ? { tolerance: q['tolerance'] as number } : {}),
      };
      interactions.push(interaction);
      return;
    }

    // text (including word-cloud alias)
    const displayOverride =
      asWordCloud
        ? 'word-cloud'
        : typeof q['display'] === 'string' && q['display'].trim() !== ''
          ? q['display'].trim()
          : undefined;
    const interaction: TextInteraction = {
      id,
      type: 'text',
      prompt: prompt.trim(),
      display: (displayOverride ?? defaultDisplay('text')) as TextDisplay,
      ...(typeof q['maxLength'] === 'number'
        ? { maxLength: q['maxLength'] as number }
        : asWordCloud
          ? { maxLength: 40 }
          : {}),
      ...(Array.isArray(q['correctAnswers'])
        ? {
            correctAnswers: (q['correctAnswers'] as unknown[]).filter(
              (a): a is string => typeof a === 'string' && a.trim() !== '',
            ),
          }
        : {}),
    };
    interactions.push(interaction);
  });

  if (errors.length > 0) return { ok: false, errors };

  const session: Session = {
    version: 1,
    meta: { title: title.trim() },
    defaults: {
      identityMode: 'pseudonymous',
      resultVisibility: 'live',
      allowAnswerChange: true,
    },
    interactions,
  };
  return { ok: true, session };
}
