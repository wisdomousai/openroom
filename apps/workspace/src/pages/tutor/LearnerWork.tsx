import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { LearnerFeedback } from '@openroom/schema';
import { ApiError, getContext, getLearnerWork, listLearnerWork, saveLearnerFeedback, type LearnerWorkDetail } from '../../api';
import { PrivateAudio, audioTime } from '../../components/PrivateAudio';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';
import { Textarea } from '@openroom/ui/components/textarea';
import { to } from '../../destinations';
import { CONTINUITY_REQUIRED, ContinuityLock, isContinuityRequired } from '../../components/ContinuityLock';
import { LoadState, PageHeading, messageOf } from './shared';

export function LearnerWorkPage({ contextId }: { contextId: string }) {
  const context = useQuery({ queryKey: ['contexts', contextId], queryFn: () => getContext(contextId) });
  const work = useQuery({ queryKey: ['contexts', contextId, 'work'], queryFn: () => listLearnerWork(contextId), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  if (!context.data || !work.data) return <LoadState error={context.error || work.error ? (isContinuityRequired(work.error) ? CONTINUITY_REQUIRED : 'Could not load learner work.') : null} />;
  return <div className="mx-auto flex max-w-3xl flex-col gap-6">
    <PageHeading title={`${context.data.displayName} — Learner work`} description="Open a response to read it alongside the task and give private feedback." />
    <Button asChild variant="outline" className="w-fit"><Link {...to.library({ spaceId: context.data.spaceId, contextId })}>Back to Library</Link></Button>
    {work.isFetching ? <p role="status" className="text-muted-foreground">Loading responses…</p> : work.data.length === 0 ? <p className="text-muted-foreground">Writing and voice responses appear here when a learner sends them.</p> : <ul className="grid gap-3">
      {work.data.map((item) => <li key={item.id}><Link {...to.studentWorkReview(contextId, item.id)} className="block rounded-xl border border-border bg-card p-5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
        <h2 className="font-semibold">{item.displayName}</h2><p className="mt-1 text-sm text-muted-foreground">{item.task.title ?? (item.task.kind === 'writing' || item.task.kind === 'voice' ? item.task.prompt : 'Response')}</p>
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-base">{item.task.kind === 'voice' ? 'Voice response' : item.body}</p><span className="mt-3 block text-sm font-medium text-primary">Review response</span>
      </Link></li>)}
    </ul>}
  </div>;
}

export function LearnerWorkReviewPage({ contextId, submissionId }: { contextId: string; submissionId: string }) {
  const detail = useQuery({ queryKey: ['contexts', contextId, 'work', submissionId], queryFn: () => getLearnerWork(contextId, submissionId) });
  if (!detail.data) return <LoadState error={detail.error ? (isContinuityRequired(detail.error) ? CONTINUITY_REQUIRED : 'Could not load this response.') : null} />;
  return <ReviewForm key={submissionId} contextId={contextId} detail={detail.data} />;
}

function ReviewForm({ contextId, detail }: { contextId: string; detail: LearnerWorkDetail }) {
  const queryClient = useQueryClient();
  const { work } = detail;
  const [feedback, setFeedback] = useState<LearnerFeedback>(detail.feedback.draft ?? { message: '', corrections: [] });
  const [version, setVersion] = useState(detail.feedback.version);
  const [published, setPublished] = useState(detail.feedback.published);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState(0);
  const change = (value: LearnerFeedback) => { setFeedback(value); setNotice(''); };
  const save = async (action: 'save' | 'publish') => {
    setBusy(true); setError(null); setNotice('');
    try {
      const saved = await saveLearnerFeedback(contextId, work.id, { feedback, version, action });
      setVersion(saved.version); setPublished(saved.published);
      queryClient.setQueryData(['contexts', contextId, 'work', work.id], { ...detail, feedback: { draft: feedback, published: saved.published, version: saved.version } });
      setNotice(action === 'publish' ? `Feedback shared with ${work.displayName}.` : 'Draft saved. Only tutors in this space can see it.');
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409 ? 'Another tutor edited this feedback. Copy your changes before reloading.' : cause instanceof ApiError && cause.message === 'correction-not-in-submission' ? 'Each correction must quote words from this response.' : cause instanceof ApiError && cause.status === 422 ? 'Complete each correction before saving.' : messageOf(cause, 'Could not save feedback.'));
    } finally { setBusy(false); }
  };
  return <div className="mx-auto flex max-w-5xl flex-col gap-6">
    <PageHeading title={`${work.displayName}’s ${work.task.kind === 'voice' ? 'voice response' : 'writing'}`} description="Draft feedback stays private until you share it with the learner." />
    <Button asChild variant="outline" className="w-fit"><Link {...to.studentWork(contextId)}>Back to learner work</Link></Button>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        <Card><CardHeader><CardTitle className="text-base">{work.task.title ?? 'The task'}</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap text-base leading-relaxed">{work.task.kind === 'writing' || work.task.kind === 'voice' ? work.task.prompt : ''}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">{work.displayName}’s response</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap text-base leading-relaxed">{work.audio ? <PrivateAudio submissionId={work.id} {...work.audio} contextId={contextId} onPosition={setPosition} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['contexts', contextId, 'work'] })} /> : work.body}</CardContent></Card>
        {detail.earlier.length > 0 ? <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Other responses to this task</summary><div className="mt-4 grid gap-4">{detail.earlier.map((item) => <div key={item.id} className="border-t border-border pt-4"><p className="whitespace-pre-wrap text-base">{item.task.kind === 'voice' ? 'Voice response' : item.body}</p><Link {...to.studentWorkReview(contextId, item.id)} className="mt-2 inline-block text-sm text-primary underline">Open response</Link></div>)}</div></details> : null}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save('save'); }} className="grid gap-5 rounded-xl border border-border bg-card p-5">
        <div className="grid gap-2"><Label htmlFor="feedback-message">Feedback</Label><Textarea id="feedback-message" rows={6} maxLength={10_000} value={feedback.message} onChange={(event) => change({ ...feedback, message: event.target.value })} placeholder="What worked well? What should they try next?" /></div>
        {work.task.kind === 'writing' ? <div className="grid gap-4">
          {feedback.corrections.map((correction, index) => <fieldset key={index} className="grid gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Correction {index + 1}</legend>
            {(['original', 'replacement', 'explanation'] as const).map((field) => <div key={field} className="grid gap-1.5"><Label htmlFor={`correction-${index}-${field}`}>{field === 'original' ? 'Their words' : field === 'replacement' ? 'Suggested wording' : 'Why'}</Label><Input id={`correction-${index}-${field}`} maxLength={2000} value={correction[field]} onChange={(event) => change({ ...feedback, corrections: feedback.corrections.map((row, i) => i === index ? { ...row, [field]: event.target.value } : row) })} /></div>)}
            <Button type="button" variant="ghost" className="w-fit" onClick={() => change({ ...feedback, corrections: feedback.corrections.filter((_, i) => i !== index) })}><Trash2 /> Remove correction</Button>
          </fieldset>)}
          <Button type="button" variant="outline" className="w-fit" disabled={feedback.corrections.length >= 30} onClick={() => change({ ...feedback, corrections: [...feedback.corrections, { original: '', replacement: '', explanation: '' }] })}><Plus /> Add correction</Button>
        </div> : null}
        {work.audio ? <div className="grid gap-4">
          {(feedback.audioComments ?? []).map((note, index) => <fieldset key={index} className="grid gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">At {audioTime(note.atMs)}</legend>
            <Label htmlFor={`audio-comment-${index}`}>Feedback at this point</Label>
            <Textarea id={`audio-comment-${index}`} maxLength={2000} value={note.comment} onChange={(event) => change({ ...feedback, audioComments: feedback.audioComments!.map((row, i) => i === index ? { ...row, comment: event.target.value } : row) })} />
            <Button type="button" variant="ghost" className="w-fit" onClick={() => change({ ...feedback, audioComments: feedback.audioComments!.filter((_, i) => i !== index) })}><Trash2 /> Remove comment</Button>
          </fieldset>)}
          <Button type="button" variant="outline" className="w-fit" disabled={(feedback.audioComments?.length ?? 0) >= 30} onClick={() => change({ ...feedback, audioComments: [...(feedback.audioComments ?? []), { atMs: position, comment: '' }] })}><Plus /> Comment at {audioTime(position)}</Button>
        </div> : null}
        {error === CONTINUITY_REQUIRED ? <ContinuityLock /> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={busy}>Save draft</Button><Button type="button" disabled={busy || (!feedback.message.trim() && feedback.corrections.length === 0 && !feedback.audioComments?.length)} onClick={() => void save('publish')}>{published ? 'Share updated feedback' : 'Share feedback'}</Button></div>
        {published ? <details className="text-sm"><summary className="cursor-pointer">What the learner can see</summary><p className="mt-2 whitespace-pre-wrap">{published.message}</p>{published.corrections.map((row, index) => <p key={index} className="mt-2">{row.original} → {row.replacement}<br />{row.explanation}</p>)}{published.audioComments?.map((note, index) => <p key={index} className="mt-2">{audioTime(note.atMs)} — {note.comment}</p>)}</details> : null}
      </form>
    </div>
  </div>;
}
