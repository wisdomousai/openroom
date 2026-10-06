/**
 * The meaning breakout: one card over the slide, on a scrim.
 *
 * Three sections — translation, senses, forms — behind tabs, and the card is
 * the whole lookup UI while it is up: sense choice, typed meanings, the
 * language-pair setter and the push all live here. The ribbon keeps only a
 * launcher. Nothing leaves the tutor's screen until they press the push.
 *
 * Colour, per DESIGN.md: orange on the push (the learner being in it), blue
 * only on the acts inside the card. One shadow — the overlay one.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DictionaryEntry, FormSection } from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import { cn } from '@openroom/ui/utils';

/** What the lookup produced for the word under the card. */
export type BreakoutLookup =
  | { kind: 'loading'; word: string }
  | {
      kind: 'entry';
      word: string;
      entry: DictionaryEntry;
      /** Translation into the learner's language; null in a monolingual session. */
      translation: string | null;
      note: string | null;
    }
  /** No entry (or the lookup failed) — the tutor types the meaning. */
  | { kind: 'typed'; word: string; note: string }
  /** The space has no language pair; the card carries the setter. */
  | { kind: 'pair'; word: string; note: string };

export interface MeaningBreakoutProps {
  lookup: BreakoutLookup;
  /** The meaning that would go under the word — picked or typed. */
  chosen: string;
  onChosen: (text: string) => void;
  /** “Camille's screen” in a tutoring session, “the wall” otherwise. */
  screenLabel: string;
  pushed: boolean;
  hasPublished: boolean;
  canPublish: boolean;
  publishing: boolean;
  publishError: string | null;
  selectedSections: string[];
  onSections: (keys: string[]) => void;
  onPush: () => void;
  onTakeDown: () => void;
  canAddSlide: boolean;
  onAddSlide: () => void;
  onClose: () => void;
  /** Language-pair fields, rendered by the owner (they hold the hook state). */
  pairFields?: ReactNode;
  pairComplete?: boolean;
  pairSaving?: boolean;
  onSavePair?: () => void;
  /** Give up on the pair and type the meaning instead. */
  onTypeInstead?: () => void;
}

type TabId = 'translation' | 'senses' | 'forms';

/**
 * Where the clicked form sits in the entry's own tables — “1st person
 * singular, indicative present”. Null when the form is not in any table
 * (or the click was on the lemma itself).
 */
function formDescription(entry: DictionaryEntry): string | null {
  if (entry.word === entry.lemma) return null;
  for (const section of entry.sections) {
    for (const row of section.rows) {
      for (let index = 0; index < row.cells.length; index += 1) {
        if (row.cells[index] !== entry.word) continue;
        const column = section.columnLabels[index];
        const where = column === undefined ? row.label : `${row.label} ${column}`;
        return `${where}, ${section.label.toLowerCase()}`;
      }
    }
  }
  return null;
}

const chip = 'rounded-full bg-muted px-2.5 py-0.5 text-caption text-muted-foreground';

function Chips({ entry }: { entry: DictionaryEntry }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 pt-2">
      <span className="text-base italic text-muted-foreground">{entry.pos}</span>
      {entry.labels.map((label) => (
        <span key={label} className={chip}>
          {label}
        </span>
      ))}
      {entry.resolvedFrom === undefined ? null : (
        <span className={chip}>from {entry.resolvedFrom}</span>
      )}
    </div>
  );
}

/** One forms block: person × number stays a table, tagless families are chips. */
function FormsSection({ section, highlight }: { section: FormSection; highlight: string }) {
  const flat = section.columnLabels.length === 0;
  return (
    <div>
      <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {section.label}
      </div>
      {flat ? (
        <div className="flex flex-wrap gap-2">
          {section.rows.flatMap((row) =>
            row.cells.map((cell, index) =>
              cell === null ? null : (
                <span
                  key={`${row.label}-${String(index)}`}
                  className={cn(
                    'rounded-full border border-border px-3.5 py-1 text-lg',
                    cell === highlight && 'border-live-tint bg-live-tint font-semibold text-live-tint-foreground',
                  )}
                >
                  {cell}
                </span>
              ),
            ),
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-lg">
            <thead>
              <tr>
                <th scope="col" className="border-b border-border p-0" />
                {section.columnLabels.map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap border-b border-border px-2.5 py-1 text-left font-normal text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="whitespace-nowrap border-b border-border px-2.5 py-1 text-left font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td
                      key={`${row.label}-${String(index)}`}
                      className={cn(
                        'border-b border-border px-2.5 py-1',
                        cell !== null &&
                          cell === highlight &&
                          'bg-live-tint font-semibold text-live-tint-foreground',
                      )}
                    >
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MeaningBreakout(props: MeaningBreakoutProps) {
  const { lookup, chosen, onChosen, onClose } = props;
  const entry = lookup.kind === 'entry' ? lookup.entry : null;

  const tabs = useMemo<TabId[]>(() => {
    if (lookup.kind !== 'entry') return [];
    const list: TabId[] = [];
    if (lookup.translation !== null) list.push('translation');
    if (lookup.entry.senses.length > 0) list.push('senses');
    if (lookup.entry.sections.length > 0) list.push('forms');
    return list;
  }, [lookup]);

  const [tab, setTab] = useState<TabId>('translation');
  const active: TabId | null = tabs.length === 0 ? null : tabs.includes(tab) ? tab : (tabs[0] ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Every meaning on offer that is not the chosen one. */
  const alternates = useMemo(() => {
    if (lookup.kind !== 'entry') return [];
    const options = [
      ...(lookup.translation === null ? [] : [lookup.translation]),
      ...lookup.entry.senses.map((sense) => sense.gloss),
    ];
    return [...new Set(options)].filter((option) => option !== chosen);
  }, [lookup, chosen]);

  const chosenExample =
    entry?.senses.find((sense) => sense.gloss === chosen && sense.example !== undefined)?.example;

  const fromForm = entry === null ? null : entry.word === entry.lemma ? null : entry.word;
  const where = entry === null ? null : formDescription(entry);

  const note =
    lookup.kind === 'entry' ? lookup.note : lookup.kind === 'loading' ? null : lookup.note;

  return (
    <div className="absolute inset-0 z-10" role="dialog" aria-label={`Meaning: ${lookup.word}`}>
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-[6%_7%] grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]">
        {/* ---- head ------------------------------------------------------ */}
        <div className="px-7 pt-6">
          <div className="flex flex-wrap items-baseline gap-4">
            <span className="text-4xl font-semibold leading-none tracking-[-0.03em]">
              {entry?.lemma ?? lookup.word}
            </span>
            {fromForm !== null ? (
              <span className="inline-flex items-baseline gap-2 text-base text-muted-foreground">
                <span aria-hidden="true">←</span>
                <span className="text-foreground">{fromForm}</span>
                <span>{where ?? 'the form on the slide'}</span>
              </span>
            ) : null}
            {lookup.kind === 'loading' ? (
              <span className="text-base text-muted-foreground">looking it up…</span>
            ) : null}
          </div>
          {entry !== null ? <Chips entry={entry} /> : null}
          {note !== null && lookup.kind !== 'entry' ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {note}
            </p>
          ) : null}
          {tabs.length > 0 ? (
            <div role="tablist" className="mt-4 flex gap-6 border-b border-hairline">
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'inline-flex h-10 items-center gap-1.5 border-b-2 px-1 text-base',
                    active === id
                      ? 'border-primary font-semibold text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {id === 'translation' ? 'Translation' : id === 'senses' ? 'Senses' : 'Forms'}
                  {id === 'senses' && entry !== null ? (
                    <span className="text-muted-foreground/70">{entry.senses.length}</span>
                  ) : null}
                  {id === 'forms' && entry !== null ? (
                    <span className="text-muted-foreground/70">{entry.sections.length}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* ---- body ------------------------------------------------------ */}
        <div className="overflow-y-auto px-7 py-5">
          {lookup.kind === 'loading' ? (
            <div className="flex flex-col gap-3">
              <span className="block h-5 w-56 rounded-sm bg-muted" />
              <span className="block h-3.5 w-80 rounded-sm bg-muted" />
              <span className="block h-3.5 w-72 rounded-sm bg-muted" />
            </div>
          ) : null}

          {lookup.kind === 'typed' ? (
            <label className="flex max-w-xl flex-col gap-1.5 text-caption text-muted-foreground">
              Meaning
              <input
                autoFocus
                value={chosen}
                maxLength={200}
                onChange={(event) => onChosen(event.target.value)}
                className="rounded-t-md border border-input border-b-2 border-b-primary bg-background px-3 py-2.5 text-lg text-foreground"
              />
            </label>
          ) : null}

          {lookup.kind === 'pair' ? (
            <div className="flex max-w-2xl flex-col gap-4">
              {props.pairFields}
              <div>
                <Button
                  type="button"
                  disabled={props.pairComplete !== true || props.pairSaving === true}
                  onClick={props.onSavePair}
                >
                  {props.pairSaving === true ? 'Saving…' : 'Save and retry'}
                </Button>
              </div>
            </div>
          ) : null}

          {lookup.kind === 'entry' && active === 'translation' ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-3xl font-semibold leading-tight tracking-[-0.02em]">
                  {chosen}
                </p>
                {chosenExample !== undefined ? (
                  <p className="text-lg text-muted-foreground">{chosenExample}</p>
                ) : null}
              </div>
              {alternates.length > 0 ? (
                <div className="flex flex-col gap-2.5 border-t border-hairline pt-4">
                  <span className="text-caption text-muted-foreground">Also translates as</span>
                  <div className="flex flex-col gap-2">
                    {alternates.map((option) => (
                      <div
                        key={option}
                        className="flex items-baseline justify-between gap-4 rounded-md border border-border bg-background px-4 py-3"
                      >
                        <span className="text-lg">{option}</span>
                        <button
                          type="button"
                          onClick={() => onChosen(option)}
                          className="shrink-0 text-sm font-semibold text-primary hover:underline"
                        >
                          Use this one
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {lookup.kind === 'entry' && active === 'senses' ? (
            <ol className="flex flex-col gap-5">
              {entry?.senses.map((sense, index) => (
                <li key={sense.gloss} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
                  <span className="text-lg tabular-nums text-muted-foreground/70">
                    {index + 1}
                  </span>
                  <span className="flex flex-col gap-1.5">
                    <span className="text-xl leading-snug">{sense.gloss}</span>
                    {sense.example !== undefined ? (
                      <span className="text-base italic text-muted-foreground">{sense.example}</span>
                    ) : null}
                    {sense.tags !== undefined && sense.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {sense.tags.map((tag) => (
                          <span key={tag} className={chip}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {lookup.kind === 'entry' && active === 'forms' && entry !== null ? (
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">Choose the forms to show with the meaning.</p>
              {entry.sections.map((section) => (
                <div key={section.key} className="grid content-start gap-3"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={props.selectedSections.includes(section.key)} disabled={props.publishing} onChange={(event) => props.onSections(event.currentTarget.checked ? [...props.selectedSections, section.key] : props.selectedSections.filter((key) => key !== section.key))} />Show {section.label}</label><FormsSection section={section} highlight={entry.word} /></div>
              ))}
            </div>
          ) : null}

          {lookup.kind === 'entry' && note !== null ? (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>

        {/* ---- foot ------------------------------------------------------ */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline bg-background px-7 py-3">
          {chosen.length > 200 ? <p role="status" className="w-full text-sm">Shorten the meaning to 200 characters before showing it.</p> : null}
          {props.publishError ? <p role="alert" className="w-full text-sm text-destructive">{props.publishError}</p> : null}
          <span className="text-caption text-muted-foreground">
            {lookup.kind === 'loading'
              ? 'Loading — Esc cancels'
              : lookup.kind === 'entry'
                ? `${entry?.source.name ?? ''} · Esc closes`
                : lookup.kind === 'typed'
                  ? 'Typed by you'
                  : ''}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {(lookup.kind === 'pair' || lookup.kind === 'entry') && props.onTypeInstead !== undefined ? (
              <Button type="button" variant="subtle" size="sm" onClick={props.onTypeInstead}>
                Type a meaning instead
              </Button>
            ) : null}
            {props.canAddSlide ? (
              <Button type="button" variant="subtle" size="sm" onClick={props.onAddSlide}>
                Add as a slide
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            {props.hasPublished ? (
              <Button
                type="button"
                size="sm"
                variant="subtle"
                className="bg-live-tint font-semibold text-live-tint-foreground hover:bg-live-tint"
                onClick={props.onTakeDown}
                disabled={props.publishing}
              >
                Take off {props.screenLabel}
              </Button>
            ) : null}
            {lookup.kind === 'loading' || lookup.kind === 'pair' || props.pushed ? null : (
              <Button
                type="button"
                size="sm"
                variant="live"
                disabled={!props.canPublish || props.publishing}
                onClick={props.onPush}
              >
                {props.publishing ? 'Showing…' : props.hasPublished ? `Update ${props.screenLabel}` : `On ${props.screenLabel}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
