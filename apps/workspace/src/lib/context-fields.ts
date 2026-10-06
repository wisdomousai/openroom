/** The context — four light questions and a paragraph. Nothing required. */

export const LEVEL_CHIPS = ['Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11'] as const;
export const LANGUAGE_LEVEL_CHIPS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const FREQUENCY_CHIPS = ['Weekly', 'Fortnightly', 'Now and then', 'A block of sessions'] as const;

export interface ContextFields {
  level: string;
  frequency: string;
  goals: string;
  notes: string;
  /** Kept so an existing subject/language still round-trips. */
  language: string;
  subject: string;
}

function strField(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

export function fieldsFromContext(context: Record<string, unknown> | undefined): ContextFields {
  const c = context ?? {};
  const goals = c.goals;
  return {
    level: strField(c.level),
    frequency: strField(c.frequency),
    goals: Array.isArray(goals) ? goals.map(String).join('\n') : strField(goals),
    notes: strField(c.notes ?? c.progress ?? c.accommodations),
    language: strField(c.language),
    subject: strField(c.subject),
  };
}

export function contextFromFields(fields: ContextFields): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (fields.level.trim()) context.level = fields.level.trim();
  if (fields.frequency.trim()) context.frequency = fields.frequency.trim();
  if (fields.language.trim()) context.language = fields.language.trim();
  if (fields.subject.trim()) context.subject = fields.subject.trim();
  const goals = fields.goals
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (goals.length === 1) context.goals = goals[0];
  else if (goals.length > 1) context.goals = goals;
  if (fields.notes.trim()) context.notes = fields.notes.trim();
  return context;
}

export interface ContextChip {
  label: string;
  emphasis?: boolean;
}

/** Answer chips on the context. The goal chip is the emphasised one. */
export function contextChips(fields: ContextFields): ContextChip[] {
  const chips: ContextChip[] = [];
  if (fields.level.trim()) chips.push({ label: fields.level.trim() });
  const about = [fields.subject.trim(), fields.language.trim()].filter(Boolean).join(', ');
  if (about) chips.push({ label: about });
  if (fields.frequency.trim()) chips.push({ label: fields.frequency.trim() });
  const goal = fields.goals
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (goal) chips.push({ label: goal, emphasis: true });
  return chips;
}

export function contextIsEmpty(fields: ContextFields): boolean {
  return (
    fields.level.trim() === '' &&
    fields.frequency.trim() === '' &&
    fields.goals.trim() === '' &&
    fields.notes.trim() === '' &&
    fields.language.trim() === '' &&
    fields.subject.trim() === ''
  );
}
