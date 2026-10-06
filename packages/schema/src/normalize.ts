import { DEFAULT_TEXT_MAX_LENGTH, defaultDisplay } from './schema.js';
import { normalizeDisplayOptions } from './display-options.js';
import type {
  Display,
  Interaction,
  NormalizedDefaults,
  NormalizedInteraction,
  NormalizedQna,
  NormalizedSession,
  Session,
} from './types.js';

export const DEFAULT_QNA_MAX_LENGTH = 300;

/**
 * Fill every default and return a canonical session. Pure: the input is not mutated.
 *
 * Defaults applied:
 *  - defaults.identityMode        -> 'pseudonymous'
 *  - defaults.resultVisibility    -> 'live'
 *  - defaults.allowAnswerChange   -> true
 *  - defaults.theme               -> 'default'
 *  - interaction.resultVisibility -> session default
 *  - interaction.allowAnswerChange-> session default
 *  - interaction.allowDontKnow    -> false
 *  - interaction.display          -> first display style for the type
 *  - interaction.displayOptions   -> defaults for the selected display (irrelevant keys stripped)
 *  - choice.multiple              -> false
 *  - choice.peerInstruction       -> false
 *  - text.maxLength               -> 200
 *  - qna.enabled                  -> false
 *  - qna.maxLength                -> 300
 */
export function normalizeSession(session: Session): NormalizedSession {
  const defaults: NormalizedDefaults = {
    identityMode: session.defaults?.identityMode ?? 'pseudonymous',
    resultVisibility: session.defaults?.resultVisibility ?? 'live',
    allowAnswerChange: session.defaults?.allowAnswerChange ?? true,
    theme: session.defaults?.theme ?? 'default',
  };

  const qna: NormalizedQna = {
    enabled: session.qna?.enabled ?? false,
    maxLength: session.qna?.maxLength ?? DEFAULT_QNA_MAX_LENGTH,
  };

  const interactions = session.interactions.map((interaction) =>
    normalizeInteraction(interaction, defaults),
  );

  return {
    version: 1,
    meta: { ...session.meta },
    defaults,
    qna,
    interactions,
  };
}

function trimmedWords(words: readonly string[] | undefined): string[] | undefined {
  if (words === undefined) return undefined;
  const next = words.map((word) => word.trim()).filter((word) => word !== '');
  return next.length > 0 ? next : undefined;
}

function withBase<T extends Interaction>(
  interaction: T,
  defaults: NormalizedDefaults,
  display: Display,
): T & {
  resultVisibility: 'hidden-until-close' | 'live';
  allowAnswerChange: boolean;
  allowDontKnow: boolean;
  display: Display;
  displayOptions: NonNullable<ReturnType<typeof normalizeDisplayOptions>>;
} {
  const displayOptions = normalizeDisplayOptions(display, interaction.displayOptions) ?? {};
  return {
    ...interaction,
    display,
    displayOptions,
    resultVisibility: interaction.resultVisibility ?? defaults.resultVisibility,
    allowAnswerChange: interaction.allowAnswerChange ?? defaults.allowAnswerChange,
    allowDontKnow: interaction.allowDontKnow ?? false,
  };
}

function normalizeInteraction(
  interaction: Interaction,
  defaults: NormalizedDefaults,
): NormalizedInteraction {
  switch (interaction.type) {
    case 'choice': {
      const display = interaction.display ?? 'bars';
      return {
        ...withBase(interaction, defaults, display),
        display,
        options: interaction.options.map((option) => ({ ...option })),
        multiple: interaction.multiple ?? false,
        peerInstruction: interaction.peerInstruction ?? false,
      };
    }
    case 'scale': {
      const display = interaction.display ?? 'dots';
      return { ...withBase(interaction, defaults, display), display };
    }
    case 'numeric': {
      const display = interaction.display ?? 'histogram';
      return { ...withBase(interaction, defaults, display), display };
    }
    case 'text': {
      const display = interaction.display ?? 'list';
      return {
        ...withBase(interaction, defaults, display),
        display,
        maxLength: interaction.maxLength ?? DEFAULT_TEXT_MAX_LENGTH,
      };
    }
    case 'qna': {
      const display = interaction.display ?? 'list';
      return { ...withBase(interaction, defaults, display), display };
    }
    case 'ranking': {
      const display = interaction.display ?? 'ordered-bars';
      return {
        ...withBase(interaction, defaults, display),
        display,
        options: interaction.options.map((option) => ({ ...option })),
      };
    }
    case 'fill-the-gaps': {
      const display = interaction.display ?? 'gaps';
      const { bank: _rawBank, ...base } = withBase(interaction, defaults, display);
      const bank = trimmedWords(interaction.bank);
      return {
        ...base,
        display,
        gaps: interaction.gaps.map((gap) => {
          const distractors = trimmedWords(gap.distractors);
          return {
            id: gap.id,
            answers: [...gap.answers],
            ...(distractors !== undefined ? { distractors } : {}),
          };
        }),
        ...(bank !== undefined ? { bank } : {}),
      };
    }
    case 'match': {
      const display = interaction.display ?? 'pairs';
      return {
        ...withBase(interaction, defaults, display),
        display,
        left: interaction.left.map((item) => ({ ...item })),
        right: interaction.right.map((item) => ({ ...item })),
        correct: { ...interaction.correct },
      };
    }
    default: {
      const never: never = interaction;
      throw new Error(`unknown interaction type: ${JSON.stringify(never)}`);
    }
  }
}

/** Convenience: the default display style for a type (re-exported for callers). */
export { defaultDisplay };

/**
 * Step fields the contract has withdrawn. Accepted on input and silently dropped —
 * never rejected — exactly as unknown `displayOptions` keys are stripped
 * (`display-options.ts`). Outline steps are `additionalProperties: false`, so a
 * bare removal would turn every stored outline carrying the field into a hard
 * validation failure.
 *
 *  - `kicker`: an eyebrow label above a heading. DESIGN.md's No-Kicker Rule
 *    forbids ever rendering one, so the field was a promise the product refused
 *    to keep. Removed from the contract in the deck-editor schema pass.
 */
export const DEPRECATED_OUTLINE_STEP_KEYS = ['kicker'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Drop withdrawn step fields before an outline is validated. Pure: the input is
 * not mutated, and anything that is not outline-shaped is returned untouched so
 * the validator still produces the real structural error.
 */
export function stripDeprecatedOutlineFields(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.steps)) return input;

  let changed = false;
  const steps = input.steps.map((step) => {
    if (!isRecord(step)) return step;
    if (!DEPRECATED_OUTLINE_STEP_KEYS.some((key) => key in step)) return step;
    changed = true;
    const clean: Record<string, unknown> = { ...step };
    for (const key of DEPRECATED_OUTLINE_STEP_KEYS) delete clean[key];
    return clean;
  });

  return changed ? { ...input, steps } : input;
}
