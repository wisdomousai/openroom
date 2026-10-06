import { WORKSPACE_EXPERIENCES, type WorkspaceExperience } from '@openroom/schema';
import { EXPERIENCES } from '../shell/experiences';
import { cn } from '../lib/utils';

export function ExperienceFields({ value, onChange, disabled = false }: {
  value: WorkspaceExperience;
  onChange: (value: WorkspaceExperience) => void;
  disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-3 text-base font-semibold">Workspace experience</legend>
    <div className="grid gap-3 sm:grid-cols-3">
      {WORKSPACE_EXPERIENCES.map((experience) => <label key={experience}
        className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', value === experience ? 'border-primary bg-accent' : 'border-border bg-card', disabled && 'cursor-default opacity-70')}>
        <input type="radio" name="workspace-experience" value={experience} checked={value === experience}
          onChange={() => onChange(experience)} className="mt-1 accent-primary" />
        <span><span className="block font-medium">{EXPERIENCES[experience].label}</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{EXPERIENCES[experience].description}</span></span>
      </label>)}
    </div>
  </fieldset>;
}
