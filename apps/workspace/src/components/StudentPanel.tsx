import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';

import type { LinkTarget } from '../destinations';
import type { StudentKind, SpaceSettings } from '@openroom/schema';

import { profileChips, profileIsEmpty, fieldsFromProfile } from '../lib/profile-fields';
import { givenName } from '../lib/initials';
import { cn } from '@openroom/ui/utils';

interface Props {
  displayName: string;
  /** A person is called by their given name; a group or class by its whole name. */
  kind: StudentKind;
  profile: Record<string, unknown>;
  nextNote?: string;
  onEdit?: () => void;
  /** The space's language pair, which word lookup reads. */
  languages?: SpaceSettings['languages'];
  /** Space settings, where the pair is set. Absent when the viewer cannot. */
  settingsTo?: LinkTarget | null;
}

/**
 * The student — four answers and a paragraph, pinned to the person's folder.
 * Agents read this before they draft a deck.
 */
export function StudentPanel({
  displayName,
  kind,
  profile,
  nextNote,
  onEdit,
  languages,
  settingsTo,
}: Props) {
  const fields = fieldsFromProfile(profile);
  const chips = profileChips(fields);
  const empty = profileIsEmpty(fields);
  const who = kind === 'person' ? givenName(displayName) : displayName;

  return (
    <section className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card">
      {nextNote !== undefined && nextNote.trim() !== '' ? <NextNote note={nextNote.trim()} /> : null}
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
                    'inline-flex min-h-[26px] max-w-full items-center rounded-full px-2.5 py-0.5 text-rail font-normal',
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
            ? `No language pair for ${who}. Word lookup needs one.`
            : `Agents and the CLI read this student before drafting a deck for ${who}.`}
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

/**
 * The note from the last Notes, kept to two lines so a long one does not push
 * the decks off the screen. The whole note is one press away.
 */
function NextNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = text.current;
    if (!element || open) return;
    const measure = () => setLong(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [note, open]);

  return (
    <div className="border-b border-hairline px-[18px] py-3">
      <p className="text-caption text-muted-foreground">Next session</p>
      <p
        ref={text}
        id="next-session-note"
        className={cn('whitespace-pre-line text-secondary leading-relaxed text-pretty', !open && 'line-clamp-2')}
      >
        {note}
      </p>
      {long || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="next-session-note"
          className="mt-1 text-caption font-semibold text-primary hover:underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </div>
  );
}
