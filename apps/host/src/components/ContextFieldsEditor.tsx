import {
  FREQUENCY_CHIPS,
  LANGUAGE_LEVEL_CHIPS,
  type ContextFields,
} from '../lib/context-fields';
import { cn } from '@openroom/ui/utils';
import { Input } from '@openroom/ui/components/input';
import { Textarea } from '@openroom/ui/components/textarea';

function Chip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-[30px] items-center rounded-full px-3 text-rail font-normal',
        selected
          ? 'bg-accent font-semibold text-accent-foreground'
          : 'border border-input text-[color:color-mix(in_oklab,var(--foreground)_72%,var(--muted-foreground))] hover:bg-chrome',
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

interface Props {
  value: ContextFields;
  onChange: (next: ContextFields) => void;
  levelSuggestions?: readonly string[];
}

/** The four questions. Shared by the context dialog and the create page. */
export function ContextFieldsEditor({ value, onChange, levelSuggestions = LANGUAGE_LEVEL_CHIPS }: Props) {
  const customLevel = value.level !== '' && !levelSuggestions.includes(value.level);

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-row-title">Level</legend>
        <div className="flex flex-wrap gap-1.5">
          {levelSuggestions.map((chip) => (
            <Chip
              key={chip}
              label={chip}
              selected={value.level === chip}
              onSelect={() => onChange({ ...value, level: value.level === chip ? '' : chip })}
            />
          ))}
          <Input
            variant="add"
            value={customLevel ? value.level : ''}
            placeholder="B1, advanced, Grade 6…"
            aria-label="Or type a level"
            className="h-[30px] min-w-[160px] flex-1 rounded-full"
            onChange={(event) => onChange({ ...value, level: event.currentTarget.value })}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-row-title">Frequency</legend>
        <div className="flex flex-wrap gap-1.5">
          {FREQUENCY_CHIPS.map((chip) => (
            <Chip
              key={chip}
              label={chip}
              selected={value.frequency === chip}
              onSelect={() =>
                onChange({ ...value, frequency: value.frequency === chip ? '' : chip })
              }
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="context-goals" className="text-row-title">
          Goal
        </label>
        <Input
          id="context-goals"
          value={value.goals}
          onChange={(event) => onChange({ ...value, goals: event.currentTarget.value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="context-notes" className="text-row-title">
          Notes
        </label>
        <Textarea
          id="context-notes"
          rows={5}
          value={value.notes}
          onChange={(event) => onChange({ ...value, notes: event.currentTarget.value })}
        />
        <p className="text-caption text-muted-foreground">Do not paste school documents.</p>
      </div>
    </div>
  );
}
