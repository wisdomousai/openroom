import type { Interaction, ParticipantInteraction, Session } from './types.js';
import { fillTheGapsBankWords, fillTheGapsGapOptions } from './fill-the-gaps-match.js';

/**
 * Project an interaction down to what a participant (and the stage) may see
 * before reveal (API-06). Strips exactly:
 *   - `notes`                (host-only)
 *   - `correct`              (numeric correct value, choice option correctness)
 *   - `correctAnswers`       (text short-answer scoring)
 *   - `correctOrder`         (ranking correct permutation)
 *   - `misconception`        (distractor labels)
 *   - `tolerance`            (numeric scoring window)
 *   - `pedagogy`             (objective/explanation/followUp/durationSec — host
 *                             teaching metadata, including post-reveal explanations;
 *                             known deviation fix, see PRD §6 "explanations after reveal"
 *                             and CONTRACTS.md — pedagogy must never leak to participants)
 *
 * Returns `null` when the interaction id is not in the session.
 */
export function participantView(
  session: Session,
  interactionId: string,
): ParticipantInteraction | null {
  const interaction = session.interactions.find((candidate) => candidate.id === interactionId);
  if (interaction === undefined) return null;
  return projectInteraction(interaction);
}

/** Same projection, applied directly to an interaction object. */
export function projectInteraction(interaction: Interaction): ParticipantInteraction {
  switch (interaction.type) {
    case 'choice': {
      const { notes: _notes, pedagogy: _pedagogy, options, ...rest } = interaction;
      return {
        ...rest,
        // Explicit allowlist: `correct` / `misconception` must not leak, and a
        // new option column stays private until it is added here on purpose.
        options: options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.labelSpans === undefined ? {} : { labelSpans: option.labelSpans }),
        })),
      };
    }
    case 'numeric': {
      const {
        notes: _notes,
        pedagogy: _pedagogy,
        correct: _correct,
        tolerance: _tolerance,
        ...rest
      } = interaction;
      return rest;
    }
    case 'scale': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
    case 'text': {
      const {
        notes: _notes,
        pedagogy: _pedagogy,
        correctAnswers: _correctAnswers,
        ...rest
      } = interaction;
      return rest;
    }
    case 'qna': {
      const { notes: _notes, pedagogy: _pedagogy, ...rest } = interaction;
      return rest;
    }
    case 'ranking': {
      const {
        notes: _notes,
        pedagogy: _pedagogy,
        correctOrder: _correctOrder,
        options,
        ...rest
      } = interaction;
      return {
        ...rest,
        options: options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.labelSpans === undefined ? {} : { labelSpans: option.labelSpans }),
        })),
      };
    }
    case 'fill-the-gaps': {
      const { notes: _notes, pedagogy: _pedagogy, gaps, bank: _bank, ...rest } = interaction;
      const bankWords = fillTheGapsBankWords(interaction);
      return {
        ...rest,
        gaps: gaps.map((gap) => {
          const options = fillTheGapsGapOptions(gap);
          return options.length >= 2 ? { id: gap.id, options } : { id: gap.id };
        }),
        ...(bankWords.length >= 2 ? { bankWords } : {}),
      };
    }
    case 'match': {
      const { notes: _notes, pedagogy: _pedagogy, correct: _correct, left, right, ...rest } =
        interaction;
      const styled = (item: (typeof left)[number]) => ({
        id: item.id,
        label: item.label,
        ...(item.labelSpans === undefined ? {} : { labelSpans: item.labelSpans }),
      });
      return {
        ...rest,
        left: left.map(styled),
        right: right.map(styled),
      };
    }
    default: {
      const never: never = interaction;
      throw new Error(`unknown interaction type: ${JSON.stringify(never)}`);
    }
  }
}
