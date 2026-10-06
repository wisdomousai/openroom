import { Link } from '@tanstack/react-router';

import type { LinkTarget } from '../destinations';
import type { SpaceSettings } from '@openroom/schema';

import { contextChips, contextIsEmpty, fieldsFromContext } from '../lib/context-fields';
import { givenName } from '../lib/initials';
import { cn } from '../lib/utils';

interface Props {
  displayName: string;
  context: Record<string, unknown>;
  nextNote?: string;
  onEdit?: () => void;
  /** The space's language pair, which word lookup reads. */
  languages?: SpaceSettings['languages'];
  /** Space settings, where the pair is set. Absent when the viewer cannot. */
  settingsTo?: LinkTarget | null;
}

/**
 * The context — four answers and a paragraph, pinned to the person's folder.
 * Agents read this before they draft a deck.
 */
export function ContextPanel({
  displayName,
  context,
  nextNote,
  onEdit,
  languages,
  settingsTo,
}: Props) {
  const fields = fieldsFromContext(context);
  const chips = contextChips(fields);
  const empty = contextIsEmpty(fields);
  const who = givenName(displayName);

  return (
    <section className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card">
      {nextNote !== undefined && nextNote.trim() !== '' ? (
        <div className="border-b border-hairline px-[18px] py-3">
          <p className="text-caption text-muted-foreground">Next session</p>
          <p className="text-secondary leading-relaxed text-pretty">{nextNote.trim()}</p>
        </div>
      ) : null}
      <div className="flex items-center gap-2.5 px-[18px] pb-2.5 pt-3.5">
        <h2 className="text-section">{who}</h2>
        <span className="flex-1" />
        {onEdit ? (
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md px-2.5 text-rail font-normal text-primary hover:bg-accent"
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
      </div>

      {empty ? (
        <p className="px-[18px] pb-4 text-secondary text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <>
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-[18px] pb-3.5">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className={cn(
                    'inline-flex h-[26px] items-center rounded-full px-2.5 text-rail font-normal',
                    chip.emphasis
                      ? 'bg-accent font-semibold text-accent-foreground'
                      : 'bg-chrome text-[color:color-mix(in_oklab,var(--foreground)_72%,var(--muted-foreground))]',
                  )}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          ) : null}
          {fields.notes.trim() ? (
            <p className="max-w-[76ch] px-[18px] pb-4 text-secondary leading-relaxed text-pretty">
              {fields.notes}
            </p>
          ) : null}
        </>
      )}

      <div className="flex items-center gap-2.5 border-t border-hairline bg-background px-[18px] py-3">
        {/*
          The language pair is a prerequisite, not a detail: word lookup can do
          nothing without it, and this is the only surface a tutor sees before a
          session. Saying so here means they find out while preparing rather than
          mid-session, with a word already on the wall.

          No vendor is named — the agent host is whichever one the tutor has
          configured.
        */}
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">
          {languages === undefined
            ? 'No language pair set for this space. Word lookup needs one.'
            : `Agents and the CLI read this context before drafting a deck for ${who}.`}
        </p>
        {languages === undefined && settingsTo ? (
          <Link
            {...settingsTo}
            className="shrink-0 text-caption font-semibold text-primary hover:underline"
          >
            Set language
          </Link>
        ) : null}
      </div>
    </section>
  );
}
