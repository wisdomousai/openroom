import { DictionaryTable } from '@openroom/slides';
import { useQuery } from '@tanstack/react-query';

import { ApiError, lookupDictionary } from '../../../api';
import { Textarea } from '../../../components/ui/textarea';
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
  const query = useQuery({
    queryKey: ['dictionary', deckId, word] as const,
    queryFn: () => lookupDictionary({ word, scope: { deckId } }),
    retry: false,
  });
  const result = query.data ?? null;

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
      {query.error ? (
        <p className="pt-1.5 text-caption text-muted-foreground">
          {query.error instanceof ApiError && query.error.status === 422
            ? 'This space has no language pair set.'
            : 'Lookup failed.'}
        </p>
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
      <p className="text-caption text-muted-foreground">Saved on this device.</p>
    </div>
  );
}
