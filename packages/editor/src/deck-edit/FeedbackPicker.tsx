import { useState } from 'react';
import type { LearnerCorrection } from '@openroom/schema';
import type { ContextReturned } from '../services';
import { Button } from '@openroom/ui/components/button';

export function FeedbackPicker({ corrections, onInsert }: { corrections: ContextReturned['corrections']; onInsert: (correction: LearnerCorrection) => void }) {
  const [addedId, setAddedId] = useState<string | null>(null);
  if (corrections.length === 0) return null;
  return <section className="grid gap-3 border-t border-hairline px-[18px] py-4">
    <h3 className="text-row-title">From learner feedback</h3>
    <p className="text-secondary text-muted-foreground">Adding a correction makes its wording and explanation visible in this deck.</p>
    {corrections.map((correction) => <details key={correction.id} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-secondary font-semibold">{correction.displayName} · {correction.original}</summary>
      <div className="mt-3 grid gap-3"><p className="whitespace-pre-wrap text-secondary">{correction.replacement}</p><p className="whitespace-pre-wrap text-secondary text-muted-foreground">{correction.explanation}</p><Button variant="outline" size="sm" onClick={() => { onInsert(correction); setAddedId(correction.id); }}>Add correction to deck</Button>{addedId === correction.id ? <p role="status" className="text-secondary">Correction added to deck.</p> : null}</div>
    </details>)}
  </section>;
}
