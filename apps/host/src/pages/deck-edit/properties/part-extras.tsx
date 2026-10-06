import { useState } from 'react';
import type { OutlineStep } from '@openroom/schema';

import { Button } from '../../../components/ui/button';
import {
  canAddListItem,
  canRemoveListItem,
  optionCorrect,
  partEditable,
  partLabel,
  partText,
} from '../outline-edit';
import { ChipsEditor, CommitTextarea, Section, indexOfKey, listTargetFor } from './shared';
import type { PropertiesPanelProps } from './shared';

export function PartExtras({
  outline,
  step,
  partKey,
  ...props
}: PropertiesPanelProps & { step: OutlineStep; partKey: string }) {
  const text = partText(outline, step, partKey);
  const editable = partEditable(outline, step, partKey);
  const target = listTargetFor(step, partKey);
  const interaction =
    step.kind === 'interaction'
      ? outline.interactions.find((item) => item.id === step.interactionId)
      : undefined;
  const fillTheGapsHeader = partKey === 'header' && interaction?.type === 'fill-the-gaps';
  const fillTheGapsGap = partKey.startsWith('gap-') && interaction?.type === 'fill-the-gaps';
  const gapIndex = fillTheGapsGap ? (indexOfKey(partKey) ?? 0) : 0;
  const [headerRange, setHeaderRange] = useState({ start: 0, end: 0 });
  const index = target === 'material' ? undefined : indexOfKey(partKey);
  const isOption = partKey.startsWith('option-');
  const optionIndex = isOption ? (indexOfKey(partKey) ?? 0) : 0;
  const correct = isOption && optionCorrect(outline, step, optionIndex);
  const breakout = outline.steps.find(
    (candidate) =>
      candidate.breakoutOf?.stepId === step.id && candidate.breakoutOf.afterKey === partKey,
  );

  return (
    <Section title={partLabel(step, partKey)} target={partKey}>
      {editable ? (
        <CommitTextarea
          key={partKey}
          ariaLabel={`${partLabel(step, partKey)} text`}
          value={text}
          onCommit={(next) => props.onPartText(partKey, next)}
          onSelectRange={fillTheGapsHeader ? (start, end) => setHeaderRange({ start, end }) : undefined}
        />
      ) : null}
      {isOption ? (
        <Button
          type="button"
          size="sm"
          variant={correct ? 'default' : 'outline'}
          onClick={() => props.onOptionCorrect(optionIndex)}
        >
          {correct ? '✓ Correct' : 'Mark correct'}
        </Button>
      ) : null}
      {breakout === undefined ? (
        <Button type="button" size="sm" variant="outline" onClick={() => props.onAddBreakout(partKey)}>
          Add breakout slide
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => props.onSelectStep(breakout.id)}>
            Open
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onRemoveStep(breakout.id)}>
            Remove
          </Button>
        </div>
      )}
      {fillTheGapsHeader && canAddListItem(outline, step, 'gap') ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => props.onAddListItem('gap')}>
            Add a gap
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={headerRange.end <= headerRange.start}
            onClick={() => props.onInsertGapAtRange(headerRange.start, headerRange.end)}
          >
            Gap selected text
          </Button>
        </div>
      ) : null}
      {fillTheGapsHeader && interaction?.type === 'fill-the-gaps' ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['gaps', 'Typed answer'],
              ['bank', 'Word bank'],
              ['choices', 'Choices'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                aria-pressed={interaction.display === value || (interaction.display === undefined && value === 'gaps')}
                variant={interaction.display === value || (interaction.display === undefined && value === 'gaps') ? 'default' : 'outline'}
                onClick={() => props.onInteraction?.({ ...interaction, display: value })}
              >
                {label}
              </Button>
            ))}
          </div>
          {(interaction.display ?? 'gaps') === 'gaps' ? <p className="text-caption text-muted-foreground">Learners type an answer. No word bank.</p> : null}
          {interaction.display === 'bank' ? <div data-editor-target="word-bank"><ChipsEditor
            label="Word bank extras"
            values={interaction.bank ?? []}
            onChange={props.onFillTheGapsBank}
          /></div> : null}
        </>
      ) : null}
      {fillTheGapsGap && interaction?.type === 'fill-the-gaps' ? (
        <>
          <ChipsEditor
            label="Also accepted"
            values={interaction.gaps[gapIndex]?.answers.slice(1) ?? []}
            onChange={(extras) => {
              const primary = interaction.gaps[gapIndex]?.answers[0] ?? '';
              props.onGapAnswers(gapIndex, [primary, ...extras]);
            }}
          />
          {interaction.display === 'choices' ? <ChipsEditor
            label="Wrong options"
            values={interaction.gaps[gapIndex]?.distractors ?? []}
            onChange={(distractors) => props.onGapDistractors(gapIndex, distractors)}
          /> : null}
        </>
      ) : null}
      {target === null ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAddListItem(outline, step, target)}
            onClick={() => props.onAddListItem(target, index)}
          >
            {target === 'gap' ? 'Add a gap' : 'Add'}
          </Button>
          {index === undefined ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canRemoveListItem(outline, step, target)}
              onClick={() => {
                props.onRemoveListItem(target, index);
                props.onSelectPart(null);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
