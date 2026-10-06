import {
  TIMER_STYLES,
  type OutlineStep,
  type OutlineTimerPlacement,
  type OutlineTimerStyle,
} from '@openroom/schema';
import { TIMER_TEXT_TOKENS, expandTimerText } from '@openroom/slides';

import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import { stepMinutes, stepSeconds } from '../outline-edit';
import { Section } from './shared';

export function TimingSection({
  step,
  onMinutes,
  onDurationSeconds,
}: {
  step: OutlineStep;
  onMinutes: (delta: number) => void;
  onDurationSeconds?: (seconds: number) => void;
}) {
  const total = stepSeconds(step) ?? (stepMinutes(step) ?? 5) * 60;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const chips = [1, 2, 6, 10];
  const apply = (nextMin: number, nextSec: number) => {
    const m = Math.min(120, Math.max(0, Math.floor(nextMin)));
    const s = Math.min(59, Math.max(0, Math.floor(nextSec)));
    const combined = Math.max(1, m * 60 + s);
    if (onDurationSeconds) onDurationSeconds(combined);
    else onMinutes(Math.max(1, Math.round(combined / 60)) - (stepMinutes(step) ?? 5));
  };
  return (
    <Section title="Timing">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={120}
          className="w-14 tabular-nums"
          value={minutes}
          onChange={(event) => {
            const n = Number(event.currentTarget.value);
            if (Number.isFinite(n)) apply(n, seconds);
          }}
          aria-label="Minutes"
        />
        <span className="text-secondary text-muted-foreground">min</span>
        {step.kind === 'timer' ? (
          <>
            <Input
              type="number"
              min={0}
              max={59}
              className="w-14 tabular-nums"
              value={seconds}
              onChange={(event) => {
                const n = Number(event.currentTarget.value);
                if (Number.isFinite(n)) apply(minutes, n);
              }}
              aria-label="Seconds"
            />
            <span className="text-secondary text-muted-foreground">sec</span>
          </>
        ) : (
          <>
            <span className="flex-1" />
            <Button type="button" size="sm" variant="subtle" onClick={() => onMinutes(-1)}>
              −1
            </Button>
            <Button type="button" size="sm" variant="subtle" onClick={() => onMinutes(1)}>
              +1
            </Button>
          </>
        )}
      </div>
      {step.kind === 'timer' ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((min) => (
            <button
              key={min}
              type="button"
              onClick={() => apply(min, 0)}
              className={cn(
                'inline-flex h-7 items-center rounded-full px-2.5 text-secondary',
                minutes === min && seconds === 0
                  ? 'bg-accent font-semibold text-accent-foreground'
                  : 'border border-input hover:bg-chrome',
              )}
            >
              {min} min
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        {step.kind === 'timer'
          ? 'Runs in Present and in a live session.'
          : 'Planned duration.'}
      </p>
    </Section>
  );
}

const TIMER_STYLE_WORDS: Record<OutlineTimerStyle, string> = {
  countdown: 'Countdown',
  countup: 'Count up',
  'bar-empty': 'Bar emptying',
  'bar-fill': 'Bar filling',
  hourglass: 'Hourglass',
  ring: 'Ring',
};

function TimerAuthoring({
  step,
  onTimerStyle,
  onTimerPlacement,
  onTimerPersist,
  onPartText,
}: {
  step: OutlineStep & { kind: 'timer' };
  onTimerStyle?: (style: OutlineTimerStyle) => void;
  onTimerPlacement?: (placement: OutlineTimerPlacement) => void;
  onTimerPersist?: (persist: boolean) => void;
  onPartText: (key: string, text: string) => void;
}) {
  const active: OutlineTimerStyle = step.style ?? 'countdown';
  const placement: OutlineTimerPlacement = step.placement ?? 'slide';
  const persist = step.persist !== false;
  const title = step.title ?? '';
  const preview = expandTimerText(title, step.seconds);
  return (
    <>
      <Section title="Style">
        <div className="grid grid-cols-3 gap-2">
          {TIMER_STYLES.map((style) => {
            const selected = active === style;
            return (
              <button
                key={style}
                type="button"
                title={TIMER_STYLE_WORDS[style]}
                aria-pressed={selected}
                onClick={() => onTimerStyle?.(style)}
                className={cn(
                  'grid aspect-video place-items-center rounded-md bg-card text-caption',
                  selected ? 'border-2 border-primary font-semibold' : 'border border-border hover:border-primary',
                )}
              >
                {style === 'countdown' || style === 'countup' ? '4:12' : TIMER_STYLE_WORDS[style]}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Position">
        <div className="flex gap-0.5 rounded-md bg-chrome p-0.5">
          {(
            [
              { id: 'slide', label: 'Whole slide' },
              { id: 'corner', label: 'In the corner' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onTimerPlacement?.(option.id)}
              className={cn(
                'flex-1 inline-flex h-[30px] items-center justify-center rounded-[3px] text-secondary',
                placement === option.id ? 'bg-card font-semibold' : 'text-muted-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2 text-secondary">
          <Checkbox
            checked={persist}
            onCheckedChange={(next) => onTimerPersist?.(next === true)}
            className="mt-0.5"
          />
          <span>Keep on next slide</span>
        </label>
      </Section>
      <Section title="Time in text">
        <div className="flex flex-wrap gap-1.5">
          {TIMER_TEXT_TOKENS.filter((token) => token === '{timer-minutes}' || token === '{timer}').map((token) => (
            <Button
              key={token}
              type="button"
              size="sm"
              variant="outline"
              className="font-mono text-caption"
              onClick={() => {
                const next = title === '' ? token : `${title.trimEnd()} ${token}`;
                onPartText('header', next);
              }}
            >
              {token === '{timer}' ? '{timer-clock}' : token}
            </Button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground">
          On the slide: <span className="font-semibold text-foreground">{preview || '—'}</span>.
        </p>
      </Section>
    </>
  );
}

export { TimerAuthoring };
