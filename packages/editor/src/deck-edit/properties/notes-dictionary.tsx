import { useState } from 'react';
import { DictionaryTable } from '@openroom/slides';

import { isServiceError, useEditorServices, type EditorSlots } from '../../services';
import { Button } from '@openroom/ui/components/button';
import { Textarea } from '@openroom/ui/components/textarea';
import { stepTitle } from '../outline-edit';
import type { PropertiesPanelProps } from './shared';

/**
 * The dictionary, in the deck editor.
 *
 * **This is a read.** It renders here and writes nothing to the outline, which
 * is what keeps `outline-edit` and `outline-fuzz.ts` untouched by the
 * lookup feature. The moment someone adds "insert this meaning as a slide
 * note", it must go through `outline-edit` and be classified in
 * `outline-fuzz.ts`.
 */
export function DictionarySection({
  word,
  deckId,
  onClose,
}: {
  word: string;
  deckId: string;
  onClose: () => void;
}) {
  const services = useEditorServices();
  const query = services.tools.useDictionaryEntry(word, deckId);
  const result = query.data ?? null;
  const pairSlot = services.slots.languagePair;
  const unconfigured = query.error ? (pairSlot?.unconfiguredSpace(query.error) ?? null) : null;

  return (
    <div className="border-t border-hairline px-[18px] py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-section">{word}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-caption text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      {query.isPending ? (
        <p className="pt-1.5 text-caption text-muted-foreground">Looking up…</p>
      ) : null}
      {query.error && pairSlot !== undefined && unconfigured !== null ? (
        unconfigured.canEdit ? (
          <PairSetter slot={pairSlot} spaceId={unconfigured.spaceId} onSaved={() => void query.refetch()} />
        ) : (
          <p className="pt-1.5 text-caption text-muted-foreground">
            This space has no language pair. Ask the space owner to set one in Space settings.
          </p>
        )
      ) : query.error ? (
        <div className="flex flex-col items-start gap-2 pt-1.5" role="alert">
          <p className="text-caption text-muted-foreground">
            {isServiceError(query.error) ? query.error.message : 'The lookup did not finish.'}
          </p>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {query.isFetching ? 'Looking up…' : 'Try again'}
          </Button>
        </div>
      ) : null}
      {result?.meaning != null ? <p className="pt-1.5 text-secondary">{result.meaning}</p> : null}
      {result?.entry != null ? (
        <div className="max-h-72 overflow-auto pt-2">
          <DictionaryTable entry={result.entry} highlight={word} showSenses />
        </div>
      ) : result !== null && !query.isPending ? (
        <p className="pt-1.5 text-caption text-muted-foreground">No entry found.</p>
      ) : null}
    </div>
  );
}

/** The space's language pair, set where the lookup needed it. */
function PairSetter({
  slot,
  spaceId,
  onSaved,
}: {
  slot: NonNullable<EditorSlots['languagePair']>;
  spaceId: string;
  onSaved: () => void;
}) {
  const pair = slot.usePair(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-3 pt-1.5" data-dictionary-pair>
      <p className="text-caption text-muted-foreground">
        Choose the language you teach and the one your students speak. This applies to the whole space.
      </p>
      <slot.Fields pair={pair} disabled={saving} idPrefix="deck-pair" className="flex flex-col gap-3" triggerClassName="w-full" />
      {problem === null ? null : (
        <p className="text-caption text-destructive" role="alert">{problem}</p>
      )}
      <Button
        type="button"
        size="sm"
        disabled={!pair.complete || saving}
        onClick={() => {
          setSaving(true);
          setProblem(null);
          void slot
            .save(spaceId, { taught: pair.taught, native: pair.native })
            .then(onSaved)
            .catch((error: unknown) => setProblem(isServiceError(error) ? error.message : 'The language pair was not saved. Try again.'))
            .finally(() => setSaving(false));
        }}
      >
        {saving ? 'Saving…' : 'Save and look up'}
      </Button>
    </div>
  );
}

export function NotesSection(props: PropertiesPanelProps) {
  const step = props.step;
  if (props.aside !== null) {
    return (
      <p className="border-t border-hairline px-[18px] py-3.5 text-caption text-muted-foreground">
        No notes on student pages.
      </p>
    );
  }
  if (step === null) {
    return (
      <p className="border-t border-hairline px-[18px] py-3.5 text-caption text-muted-foreground">
        Select a slide.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 border-t border-hairline px-[18px] py-3.5">
      <Textarea
        rows={8}
        aria-label={`Notes for ${stepTitle(props.outline, step)}`}
        placeholder="Notes"
        value={step.tutorNotes ?? ''}
        onChange={(event) => props.onNotes(step.id, event.currentTarget.value)}
      />
      <p className="text-caption text-muted-foreground">Saved with the deck. Students never see these notes.</p>
    </div>
  );
}
