import { useEffect, useState, type ReactNode } from 'react';
import { draftProblem, emptyDraft, maxOptions, QUESTION_KINDS, usesOptions, type QuestionDraft } from './question';

/** Create or edit one question in place. The parent saves it. */
export function QuestionForm({ initial, busy, submitLabel, onSubmit, onCancel, onDirtyChange, children }: {
  initial?: QuestionDraft;
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: QuestionDraft) => void;
  onCancel?: () => void;
  /** Reports whether the form holds changes that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Shown above the submit button, e.g. where the question is saved. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => initial ?? emptyDraft());
  const [tried, setTried] = useState(false);
  const problem = draftProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial ?? emptyDraft());
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty]);
  const set = (change: Partial<QuestionDraft>) => setDraft((value) => ({ ...value, ...change }));
  const setOption = (index: number, change: Partial<QuestionDraft['options'][number]>) => set({ options: draft.options.map((option, at) => at === index ? { ...option, ...change } : option) });
  return <form className="question-form" noValidate onSubmit={(event) => { event.preventDefault(); setTried(true); if (!problem) onSubmit(draft); }}>
    <fieldset className="kinds" disabled={busy}>
      <legend>Type</legend>
      {QUESTION_KINDS.map(({ kind, label }) => <label key={kind} className={draft.kind === kind ? 'kind selected' : 'kind'}>
        <input type="radio" name="kind" value={kind} checked={draft.kind === kind} onChange={() => setDraft((value) => ({ ...emptyDraft(kind, value), prompt: value.prompt }))} />{label}
      </label>)}
    </fieldset>
    <label className="field">Question
      <textarea rows={2} maxLength={500} value={draft.prompt} disabled={busy} placeholder={draft.kind === 'qna' ? 'What would you like to ask?' : 'Type your question'} onChange={(event) => set({ prompt: event.currentTarget.value })} />
    </label>
    {usesOptions(draft.kind) ? <fieldset className="options" disabled={busy}>
      <legend>{draft.kind === 'ranking' ? 'Items to rank' : 'Options'}</legend>
      {draft.options.map((option, index) => <div className="option" key={index}>
        <input aria-label={`Option ${index + 1}`} maxLength={200} value={option.label} placeholder={`Option ${index + 1}`} onChange={(event) => setOption(index, { label: event.currentTarget.value })} />
        {draft.kind === 'choice' ? <label className="correct" title="Correct option"><input type="checkbox" checked={option.correct} onChange={(event) => setOption(index, { correct: event.currentTarget.checked })} />Correct</label> : null}
        {draft.options.length > 2 ? <button type="button" className="text-button" aria-label={`Remove option ${index + 1}`} onClick={() => set({ options: draft.options.filter((_, at) => at !== index) })}>Remove</button> : null}
      </div>)}
      {draft.options.length < maxOptions(draft.kind) ? <button type="button" className="text-button" onClick={() => set({ options: [...draft.options, { label: '', correct: false }] })}>Add option</button> : null}
      {draft.kind === 'choice' ? <label className="check"><input type="checkbox" checked={draft.multiple} onChange={(event) => set({ multiple: event.currentTarget.checked })} />Allow more than one option</label> : null}
    </fieldset> : null}
    {draft.kind === 'scale' ? <fieldset className="scale" disabled={busy}>
      <legend>Scale</legend>
      <label className="field">From<input type="number" step={1} value={draft.min} onChange={(event) => set({ min: Number(event.currentTarget.value) })} /></label>
      <label className="field">To<input type="number" step={1} value={draft.max} onChange={(event) => set({ max: Number(event.currentTarget.value) })} /></label>
      <label className="field">Label for {draft.min}<input maxLength={60} value={draft.minLabel} placeholder="Not at all" onChange={(event) => set({ minLabel: event.currentTarget.value })} /></label>
      <label className="field">Label for {draft.max}<input maxLength={60} value={draft.maxLabel} placeholder="Completely" onChange={(event) => set({ maxLabel: event.currentTarget.value })} /></label>
    </fieldset> : null}
    {draft.kind === 'numeric' ? <label className="field">Unit (optional)<input maxLength={20} value={draft.unit} disabled={busy} placeholder="e.g. minutes" onChange={(event) => set({ unit: event.currentTarget.value })} /></label> : null}
    {draft.kind === 'word-cloud' ? <p className="hint">Participants send short answers. Common words appear larger.</p> : null}
    {draft.kind === 'qna' ? <p className="hint">Participants ask questions and vote for the ones they want answered.</p> : null}
    {tried && problem ? <p className="form-problem" role="alert">{problem}</p> : null}
    {children}
    <div className="form-actions">
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      {onCancel ? <button type="button" disabled={busy} onClick={onCancel}>Cancel</button> : null}
    </div>
  </form>;
}
