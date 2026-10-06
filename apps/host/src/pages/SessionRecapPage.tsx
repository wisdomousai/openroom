import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { recapHtml, type RecapCandidates, type RecapSelection, type SessionRecap } from '@openroom/schema';
import { request, ApiError } from '../api/client';
import { to } from '../destinations';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import type { StoredSession } from '../types';

function download(body: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SessionRecapPage({ live }: { live: StoredSession }) {
  const [source, setSource] = useState<RecapCandidates | null>(null);
  const [selection, setSelection] = useState<RecapSelection>({ revision: 0, title: '', resultIds: [], discussionIds: [], questionIds: [], discussion: '', followUp: '' });
  const [preview, setPreview] = useState<SessionRecap | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const path = `/api/sessions/${encodeURIComponent(live.sessionCode)}/recap`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPreview(null);
    void request<RecapCandidates>(path, { headers: { authorization: `Bearer ${live.hostToken}` }, signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setSource(value);
      setSelection((old) => ({ ...old, title: old.title || value.title.slice(0, 160), revision: value.revision, resultIds: [], discussionIds: [], questionIds: [] }));
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 410 ? 'The session responses have been deleted. A recap can no longer be made from them.' : 'The session could not be loaded. Check your connection and access, then try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, live.hostToken, refresh]);

  function edit(patch: Partial<RecapSelection>) { setSelection((old) => ({ ...old, ...patch })); setPreview(null); }
  function toggle(key: 'resultIds' | 'discussionIds' | 'questionIds', id: string) {
    setSelection((old) => ({ ...old, [key]: old[key].includes(id) ? old[key].filter((value) => value !== id) : [...old[key], id] }));
    setPreview(null);
  }
  async function review() {
    setReviewing(true); setError(''); setPreview(null);
    try {
      setPreview(await request<SessionRecap>(path, { method: 'POST', headers: { authorization: `Bearer ${live.hostToken}` }, body: JSON.stringify(selection) }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'The session changed. Refresh the available content and choose it again; your title, summary and follow-up will stay here.' : 'The recap could not be prepared. Check your access and selection, then try again.');
    } finally { setReviewing(false); }
  }
  const hasContent = selection.resultIds.length + selection.discussionIds.length + selection.questionIds.length > 0 || !!selection.discussion.trim() || !!selection.followUp.trim();
  return <main className="h-dvh overflow-y-auto bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="font-display text-3xl font-semibold">Workshop recap</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Choose what to take forward. Review the selected text before sharing, including any names people wrote in their answers.</p></div>
        <Button asChild variant="outline"><Link {...to.sessionConsole(live.sessionCode)}>Back to session</Link></Button>
      </header>
      {error ? <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">{error}</p> : null}
      {loading ? <p role="status">Loading available content…</p> : null}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={loading || reviewing || !source} className="min-w-0 space-y-7 disabled:opacity-60">
          <div className="space-y-2 text-sm font-medium"><label htmlFor="recap-title">Recap title</label><Input id="recap-title" value={selection.title} maxLength={160} onChange={(event) => edit({ title: event.target.value })} /></div>
          <section aria-labelledby="recap-results"><h2 id="recap-results" className="mb-3 text-lg font-semibold">Results</h2><p className="mb-3 text-sm text-muted-foreground">Choice, scale, numeric and ranking summaries. Select only those you want to share.</p>
            {source?.results.length ? <div className="space-y-2">{source.results.map((row) => <label key={row.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={selection.resultIds.includes(row.id)} onChange={() => toggle('resultIds', row.id)} /><span className="min-w-0"><span className="block break-words font-medium">{row.prompt}</span><span className="mt-1 block text-sm text-muted-foreground">{row.rows.map((item) => `${item.label}: ${Math.round(item.value * 100) / 100}`).join(' · ')}</span></span></label>)}</div> : <p className="text-sm text-muted-foreground">No results available yet.</p>}
          </section>
          {([['discussionIds', 'Discussion points', source?.discussion ?? []], ['questionIds', 'Questions', source?.questions ?? []]] as const).map(([key, label, rows]) => <section key={key} aria-label={label}><h2 className="mb-3 text-lg font-semibold">{label}</h2>{rows.length ? <div className="space-y-2">{rows.map((row) => <label key={row.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={selection[key].includes(row.id)} onChange={() => toggle(key, row.id)} /><span className="min-w-0"><span className="block whitespace-pre-wrap break-words text-sm">{row.text}</span><span className="mt-2 block text-xs text-muted-foreground">{row.prompt}</span></span></label>)}</div> : <p className="text-sm text-muted-foreground">No visible {label.toLowerCase()} available.</p>}</section>)}
          <div className="space-y-2 text-sm font-medium"><label htmlFor="recap-discussion">Discussion summary</label><Textarea id="recap-discussion" value={selection.discussion} maxLength={10000} rows={4} placeholder="Decisions and ideas you want to share" onChange={(event) => edit({ discussion: event.target.value })} /></div>
          <div className="space-y-2 text-sm font-medium"><label htmlFor="recap-followup">Shared follow-up</label><Textarea id="recap-followup" value={selection.followUp} maxLength={10000} rows={4} placeholder="Agreed actions and next steps" onChange={(event) => edit({ followUp: event.target.value })} /></div>
          <p className="text-xs text-muted-foreground">Private teaching notes are excluded. This recap is downloaded to your device; the text you write here is not saved in the space.</p>
          <Button onClick={() => void review()} disabled={!hasContent || !selection.title.trim()}>{reviewing ? 'Preparing…' : 'Review recap'}</Button>
        </fieldset>
        <section aria-label="Recap preview" className="min-w-0 rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Review before sharing</h2>{preview ? <div className="flex gap-2"><Button size="sm" onClick={() => download(recapHtml(preview), 'text/html;charset=utf-8', 'workshop-recap.html')}>Download recap</Button><Button size="sm" variant="outline" onClick={() => download(JSON.stringify(preview, null, 2) + '\n', 'application/json', 'workshop-recap.json')}>JSON</Button></div> : null}</div>
          {preview ? <><iframe title="Shareable recap" sandbox="" srcDoc={recapHtml(preview)} className="h-[68vh] min-h-96 w-full rounded-lg border bg-white" /><p className="mt-3 text-xs text-muted-foreground">The downloaded HTML opens in a browser and can be printed or saved as PDF.</p></> : <div className="flex min-h-72 items-center justify-center px-6 text-center text-sm text-muted-foreground">Choose content and press Review recap to see the document you will download.</div>}
        </section>
      </div>
      <Button className="mt-7" variant="subtle" disabled={loading || reviewing} onClick={() => setRefresh((value) => value + 1)}>Refresh available content</Button>
    </div>
  </main>;
}
