import { useState } from 'react';
import { useLearnerLanguage } from '../../lib/learner-language';
import { ArrowDown, ArrowUp, Check, RotateCcw } from 'lucide-react';
import { assessHomework, initialHomeworkAnswer, type HomeworkPracticeAnswer } from '@openroom/schema';
import { ApiError, type LearnerPracticeItem } from '../../api';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@openroom/ui/components/select';

export function PracticeCard({ item, onGrade, onRefresh, onSkip }: {
  item: LearnerPracticeItem;
  onGrade: (grade: 'again' | 'good', answer: HomeworkPracticeAnswer, assignmentRevision: number, attemptId: string) => Promise<void>;
  onRefresh: () => Promise<LearnerPracticeItem | undefined>;
  onSkip?: () => void;
}) {
  const { copy } = useLearnerLanguage();
  // Preserve the question the learner actually answered until they request its update.
  const [snapshot, setSnapshot] = useState(item);
  const interaction = snapshot.interaction;
  const [answer, setAnswer] = useState(() => initialHomeworkAnswer(interaction));
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'save' | 'changed' | 'refresh' | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [attemptGrade, setAttemptGrade] = useState<'again' | 'good' | null>(null);
  const assessment = assessHomework(interaction, answer);
  const update = (next: HomeworkPracticeAnswer) => { setAnswer(next); setError(null); setSaved(false); setAttemptId(crypto.randomUUID()); setAttemptGrade(null); };
  const record = async (grade: 'again' | 'good') => {
    setBusy(true); setError(null); setAttemptGrade(grade);
    try { await onGrade(grade, answer, snapshot.assignmentRevision, attemptId); setSaved(true); }
    catch (cause) { setError(cause instanceof ApiError && (cause.status === 409 || cause.status === 404) ? 'changed' : 'save'); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const current = await onRefresh();
      if (!current) { setUnavailable(true); return; }
      setSnapshot(current); setAnswer(initialHomeworkAnswer(current.interaction)); setRevealed(false); setSaved(false);
      setAttemptId(crypto.randomUUID()); setAttemptGrade(null); setError(null);
    } catch { setError('refresh'); } finally { setBusy(false); }
  };
  const move = (index: number, offset: number) => {
    if (answer.kind !== 'ranking') return;
    const order = [...answer.order];
    [order[index], order[index + offset]] = [order[index + offset]!, order[index]!];
    update({ kind: 'ranking', order });
  };

  if (unavailable) return <div className="grid gap-3"><p role="status" className="text-sm text-muted-foreground">{copy.practiceUnavailable}</p>{onSkip ? <Button className="min-h-11 w-fit" onClick={onSkip}>{copy.continuePractice}</Button> : null}</div>;
  return <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    {interaction.type !== 'fill-the-gaps' ? <p className="whitespace-pre-wrap text-base leading-relaxed">{interaction.prompt}</p> : null}
    <fieldset disabled={revealed || busy} className="min-w-0">
      <legend className="sr-only">{copy.yourAnswer}</legend>
      {interaction.type === 'choice' && answer.kind === 'choice' ? <div className="flex flex-col gap-2">
        {interaction.multiple ? <p className="text-sm text-muted-foreground">{copy.chooseAll}</p> : null}
        {interaction.options.map((option) => {
          const selected = answer.optionIds.includes(option.id);
          return <button key={option.id} type="button" aria-pressed={selected} onClick={() => update({ kind: 'choice', optionIds: interaction.multiple ? selected ? answer.optionIds.filter((id) => id !== option.id) : [...answer.optionIds, option.id] : [option.id] })}
            className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-base ${selected ? 'border-primary bg-accent' : 'border-input bg-background'}`}>
            <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center border ${interaction.multiple ? 'rounded' : 'rounded-full'} ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>{selected ? <Check className="size-3" /> : null}</span>
            <span>{option.label}</span>
          </button>;
        })}
      </div> : null}
      {interaction.type === 'text' && answer.kind === 'text' ? <Input aria-label={copy.yourAnswer} className="min-h-11 text-base" value={answer.text} maxLength={interaction.maxLength ?? 200} onChange={(event) => update({ kind: 'text', text: event.target.value })} autoComplete="off" /> : null}
      {interaction.type === 'fill-the-gaps' && answer.kind === 'fill-the-gaps' ? <div className="whitespace-pre-wrap text-base leading-loose">
        {interaction.prompt.split(/(\{\{[^{}]+\}\})/g).map((part, index) => {
          const id = /^\{\{([^{}]+)\}\}$/.exec(part)?.[1];
          const gapIndex = interaction.gaps.findIndex((gap) => gap.id === id);
          if (!id || gapIndex < 0) return <span key={index}>{part}</span>;
          return <Input key={index} aria-label={copy.gap(gapIndex + 1)} value={answer.gaps[id] ?? ''} maxLength={200} autoComplete="off" className="mx-1 inline-flex min-h-11 w-32 max-w-full text-base" onChange={(event) => update({ kind: 'fill-the-gaps', gaps: { ...answer.gaps, [id]: event.target.value } })} />;
        })}
      </div> : null}
      {interaction.type === 'match' && answer.kind === 'match' ? <div className="grid gap-3">
        {interaction.left.map((left) => <div key={left.id} className="grid gap-1.5 sm:grid-cols-2 sm:items-center">
          <span className="text-base">{left.label}</span>
          <Select value={answer.pairs[left.id] ?? ''} onValueChange={(value) => update({ kind: 'match', pairs: { ...answer.pairs, [left.id]: value } })} disabled={revealed || busy}>
            <SelectTrigger aria-label={copy.match(left.label)} className="min-h-11 text-base"><SelectValue placeholder={copy.chooseMatch} /></SelectTrigger>
            <SelectContent>{interaction.right.map((right) => <SelectItem key={right.id} value={right.id}>{right.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}
      </div> : null}
      {interaction.type === 'ranking' && answer.kind === 'ranking' ? <ol className="grid gap-2">
        {answer.order.map((id, index) => {
          const label = interaction.options.find((option) => option.id === id)?.label ?? '';
          return <li key={id} className="flex min-h-12 items-center gap-2 rounded-lg border border-input bg-background pl-3 pr-1">
            <span className="w-5 shrink-0 text-sm text-muted-foreground">{index + 1}</span><span className="flex-1 text-base">{label}</span>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={copy.moveUp(label)} disabled={index === 0 || revealed} onClick={() => move(index, -1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={copy.moveDown(label)} disabled={index === answer.order.length - 1 || revealed} onClick={() => move(index, 1)}><ArrowDown /></Button>
          </li>;
        })}
      </ol> : null}
    </fieldset>
    {!revealed ? <Button className="min-h-11 w-fit" disabled={!assessment.complete} onClick={() => setRevealed(true)}>{copy.check}</Button> : <div className="grid gap-3" aria-live="polite">
      <p className="text-base font-semibold">{assessment.result === 'correct' ? copy.correct : assessment.result === 'incorrect' ? copy.compare : copy.selfCheck}</p>
      {assessment.answers.length > 0 ? <div className="rounded-lg bg-muted/60 p-3"><p className="mb-1 text-sm font-medium">{assessment.result === 'incorrect' ? copy.acceptedAnswers : copy.answer}</p><ul className="grid gap-1 text-base">{assessment.answers.map((line, index) => <li key={index}>{line}</li>)}</ul></div> : <p className="text-sm text-muted-foreground">{copy.noSingleAnswer}</p>}
      <div className="flex flex-wrap gap-2">
        {assessment.result !== 'incorrect' ? <Button className="min-h-11" disabled={busy || saved || error === 'changed' || error === 'refresh' || attemptGrade === 'again'} onClick={() => void record('good')}>{saved ? copy.saved : assessment.result === 'self-check' ? copy.confident : copy.good}</Button> : null}
        <Button variant={assessment.result === 'incorrect' ? 'default' : 'outline'} className="min-h-11" disabled={busy || saved || error === 'changed' || error === 'refresh' || attemptGrade === 'good'} onClick={() => void record('again')}>{saved && assessment.result === 'incorrect' ? copy.saved : copy.again}</Button>
        <Button variant="ghost" className="min-h-11" disabled={busy || error !== null} onClick={() => { setRevealed(false); setSaved(false); setAttemptId(crypto.randomUUID()); setAttemptGrade(null); }}><RotateCcw className="size-4" /> {copy.tryAgain}</Button>
      </div>
      {error ? <div className="grid gap-2"><p role="alert" className="text-sm text-destructive">{error === 'changed' ? copy.practiceChanged : error === 'refresh' ? copy.practiceRefreshError : copy.practiceSaveError}</p>{error === 'changed' || error === 'refresh' ? <Button variant="outline" className="min-h-11 w-fit" disabled={busy} onClick={() => void refresh()}>{copy.refreshPractice}</Button> : null}</div> : null}
    </div>}
  </div>;
}
