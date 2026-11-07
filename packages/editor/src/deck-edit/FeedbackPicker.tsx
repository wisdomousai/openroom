import { useState } from 'react';
import type { LearnerCorrection } from '@openroom/schema';
import type { StudentReturned } from '../services';
import { Button } from '@openroom/ui/components/button';

export function FeedbackPicker({ corrections, onInsert }: { corrections: StudentReturned['corrections']; onInsert: (correction: LearnerCorrection) => void }) {
  // A correction goes into the deck once; adding it again would only duplicate it.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  if (corrections.length === 0) return null;
  return <section className="grid gap-3 border-t border-hairline px-[18px] py-4">
    <h3 className="text-row-title">From learner feedback</h3>
    <p className="text-secondary text-muted-foreground">Adding a correction makes its wording and explanation visible in this deck.</p>
    {corrections.map((correction) => <details key={correction.id} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-secondary font-semibold">{correction.displayName} · {correction.original}</summary>
      <div className="mt-3 grid gap-3"><p className="whitespace-pre-wrap text-secondary">{correction.replacement}</p><p className="whitespace-pre-wrap text-secondary text-muted-foreground">{correction.explanation}</p><Button variant="outline" size="sm" disabled={added.has(correction.id)} onClick={() => { onInsert(correction); setAdded((current) => new Set(current).add(correction.id)); }}>{added.has(correction.id) ? 'Added to deck' : 'Add correction to deck'}</Button><p role="status" className="text-secondary">{added.has(correction.id) ? 'Correction added to deck.' : ''}</p></div>
    </details>)}
  </section>;
}
