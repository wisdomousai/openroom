import type {
  ChoiceDisplay,
  InteractionView,
  NumericDisplay,
  RankingDisplay,
  ScaleDisplay,
  TextDisplay,
  QnaDisplay,
} from '@openroom/sdk';
import { AggregateChart } from '@openroom/charts';
import type { Aggregate, DisplayOptions, Interaction, InteractionType } from './types';

export interface ChoiceOptionLike {
  id: string;
  label: string;
  correct?: boolean;
}

export type RankingAggregate = Extract<Aggregate, { kind: 'ranking' }>;
export type AnyAggregate = Aggregate;

function Waiting({ answeredCount }: { answeredCount?: number } = {}) {
  return (
    <p className="text-sm text-muted-foreground">
      {typeof answeredCount === 'number' && answeredCount > 0
        ? `${answeredCount} answer${answeredCount === 1 ? '' : 's'} so far — waiting for more.`
        : 'Waiting for answers…'}
    </p>
  );
}

/** Build a minimal InteractionView so AggregateChart can render host previews. */
function previewInteraction(p: {
  interactionType?: string;
  display?: string;
  displayOptions?: DisplayOptions;
  options?: ChoiceOptionLike[];
  interaction?: Interaction;
}): InteractionView {
  if (p.interaction) {
    const ix = p.interaction;
    switch (ix.type) {
      case 'choice':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'choice',
          display: ix.display as ChoiceDisplay | undefined,
          displayOptions: ix.displayOptions,
          options: ix.options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.correct ? { correct: true as const } : {}),
          })),
          ...(ix.peerInstruction ? { peerInstruction: true } : {}),
          ...(ix.multiple ? { multiple: true } : {}),
        };
      case 'scale':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'scale',
          display: ix.display as ScaleDisplay | undefined,
          displayOptions: ix.displayOptions,
          min: ix.min,
          max: ix.max,
          ...(ix.minLabel ? { minLabel: ix.minLabel } : {}),
          ...(ix.maxLabel ? { maxLabel: ix.maxLabel } : {}),
        };
      case 'numeric':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'numeric',
          display: (ix.display as NumericDisplay | undefined) ?? 'histogram',
          displayOptions: ix.displayOptions,
          ...(ix.unit ? { unit: ix.unit } : {}),
          ...(typeof ix.correct === 'number' ? { correct: ix.correct } : {}),
          ...(typeof ix.tolerance === 'number' ? { tolerance: ix.tolerance } : {}),
        };
      case 'text':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'text',
          display: (ix.display as TextDisplay | undefined) ?? 'list',
          displayOptions: ix.displayOptions,
          ...(ix.maxLength ? { maxLength: ix.maxLength } : {}),
          ...(ix.correctAnswers ? { correctAnswers: ix.correctAnswers } : {}),
        };
      case 'qna':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'qna',
          display: 'list' as QnaDisplay,
          displayOptions: ix.displayOptions,
        };
      case 'ranking':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'ranking',
          display: (ix.display as RankingDisplay | undefined) ?? 'ordered-bars',
          displayOptions: ix.displayOptions,
          options: ix.options,
          ...(ix.correctOrder ? { correctOrder: ix.correctOrder } : {}),
        };
      case 'fill-the-gaps':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'fill-the-gaps',
          display: 'gaps',
          gaps: ix.gaps.map((gap) => ({ id: gap.id, answers: gap.answers })),
        };
      case 'match':
        return {
          id: ix.id,
          prompt: ix.prompt,
          type: 'match',
          display: 'pairs',
          left: ix.left,
          right: ix.right,
          correct: ix.correct,
        };
    }
  }

  const type = (p.interactionType ?? 'choice') as InteractionType;
  const display = p.display;
  const displayOptions = p.displayOptions;
  const options = p.options ?? [];

  switch (type) {
    case 'scale': {
      const nums = options.map((o) => Number(o.id)).filter((n) => Number.isFinite(n));
      const min = nums.length ? Math.min(...nums) : 1;
      const max = nums.length ? Math.max(...nums) : 5;
      return {
        id: 'preview',
        type: 'scale',
        prompt: 'Preview',
        min,
        max,
        display: display as ScaleDisplay | undefined,
        displayOptions,
      };
    }
    case 'numeric':
      return {
        id: 'preview',
        type: 'numeric',
        prompt: 'Preview',
        display: 'histogram',
        displayOptions,
      };
    case 'text':
      return {
        id: 'preview',
        type: 'text',
        prompt: 'Preview',
        display: (display as TextDisplay) ?? 'list',
        displayOptions,
      };
    case 'qna':
      return { id: 'preview', type: 'qna', prompt: 'Preview', display: 'list', displayOptions };
    case 'ranking':
      return {
        id: 'preview',
        type: 'ranking',
        prompt: 'Preview',
        display: 'ordered-bars',
        displayOptions,
        options: options.map((o) => ({ id: o.id, label: o.label })),
      };
    case 'fill-the-gaps':
      return { id: 'preview', type: 'fill-the-gaps', prompt: 'Preview', display: 'gaps', gaps: [] };
    case 'match':
      return {
        id: 'preview',
        type: 'match',
        prompt: 'Preview',
        display: 'pairs',
        left: [],
        right: [],
      };
    default:
      return {
        id: 'preview',
        type: 'choice',
        prompt: 'Preview',
        display: display as ChoiceDisplay | undefined,
        displayOptions,
        options: options.map((o) => ({
          id: o.id,
          label: o.label,
          ...(o.correct ? { correct: true as const } : {}),
        })),
      };
  }
}

export function ResultsPreview({
  aggregate,
  options,
  round1Aggregate,
  compareRounds = false,
  display,
  displayOptions,
  interactionType,
  interaction,
  audienceVisible: _audienceVisible = true,
  answeredCount,
}: {
  aggregate: AnyAggregate | undefined;
  options?: ChoiceOptionLike[] | undefined;
  round1Aggregate?: AnyAggregate | undefined;
  compareRounds?: boolean;
  display?: string;
  displayOptions?: DisplayOptions;
  interactionType?: string;
  interaction?: Interaction | null;
  audienceVisible?: boolean;
  answeredCount?: number;
}) {
  void _audienceVisible;

  if (!aggregate) return <Waiting answeredCount={answeredCount} />;

  if (aggregate.kind !== 'text' && aggregate.kind !== 'qna' && aggregate.total === 0 && !round1Aggregate) {
    return <Waiting />;
  }

  const view = previewInteraction({
    interaction: interaction ?? undefined,
    interactionType: interactionType ?? interaction?.type ?? aggregate.kind,
    display: display ?? interaction?.display,
    displayOptions: displayOptions ?? interaction?.displayOptions,
    options:
      options ??
      (interaction && (interaction.type === 'choice' || interaction.type === 'ranking')
        ? interaction.options
        : undefined),
  });

  const revealed =
    (view.type === 'choice' && view.options.some((o) => o.correct)) ||
    (view.type === 'numeric' && typeof view.correct === 'number') ||
    (view.type === 'text' && (view.correctAnswers?.length ?? 0) > 0) ||
    (view.type === 'ranking' && (view.correctOrder?.length ?? 0) > 0) ||
    // Both keys arrive only with the reveal: fill-the-gaps gaps gain `answers`, match
    // gains its `correct` map (participant-view strips them until then).
    (view.type === 'fill-the-gaps' && view.gaps.some((gap) => (gap.answers?.length ?? 0) > 0)) ||
    (view.type === 'match' && view.correct !== undefined);

  return (
    <div className="or-host-results min-h-40 w-full">
      <AggregateChart
        interaction={view}
        aggregate={aggregate}
        revealed={revealed || compareRounds}
        reduced={false}
        size="compact"
        round1Aggregate={
          compareRounds && round1Aggregate?.kind === 'choice' ? round1Aggregate : null
        }
      />
    </div>
  );
}
