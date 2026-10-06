import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { savedResultsHtml, type SavedResultsDocument } from '@openroom/schema';
import { ApiError } from '../api/client';
import { getSavedResults } from '../api/saved-results';
import { to } from '../destinations';
import { Button } from '../components/ui/button';

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

export function SavedResultsPage({ archiveId, userId }: { archiveId: string; userId: string }) {
  const query = useQuery({ queryKey: ['saved-results', userId, archiveId, 'document'], queryFn: ({ signal }) => getSavedResults(archiveId, signal), retry: false, gcTime: 0 });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [accessLost, setAccessLost] = useState(false);
  const downloadRequest = useRef<AbortController | null>(null);
  useEffect(() => () => downloadRequest.current?.abort(), []);
  async function download(format: 'report' | 'json' | 'ballots') {
    const controller = new AbortController(); downloadRequest.current?.abort(); downloadRequest.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/my/archives/${encodeURIComponent(archiveId)}${format === 'report' ? '/document' : `?format=${format}`}`, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setAccessLost(true);
        throw new Error('The file could not be downloaded. Check your access and try again.');
      }
      const blob = format === 'report' ? new Blob([savedResultsHtml((await response.json() as SavedResultsDocument).results)], { type: 'text/html;charset=utf-8' }) : await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `openroom-results${format === 'ballots' ? '-responses.csv' : format === 'report' ? '.html' : '.json'}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The file could not be downloaded.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (query.isError || accessLost) {
    const unavailable = accessLost || query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
    return <main className="grid min-h-dvh place-items-center bg-background p-6"><div className="max-w-lg space-y-5"><h1 className="font-display text-3xl font-semibold">Saved results unavailable</h1><p role="alert" className="text-muted-foreground">{unavailable ? 'This file has expired or your account no longer has access to its space.' : 'The file could not be loaded. Check your connection and try again.'}</p><div className="flex gap-3"><Button onClick={() => { setAccessLost(false); void query.refetch(); }}>Try again</Button><Button asChild variant="outline"><Link {...to.library()}>Library</Link></Button></div></div></main>;
  }
  if (!query.data) return <main className="grid min-h-dvh place-items-center bg-background"><p role="status">Loading saved results…</p></main>;
  const { file, results } = query.data;
  return <main className="min-h-dvh overflow-x-hidden bg-desk text-foreground">
    <div className="mx-auto max-w-5xl px-5 py-7 sm:px-10 sm:py-10">
      <nav aria-label="Results navigation" className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost"><Link {...to.library({ spaceId: file.spaceId, folderId: file.folderId, itemId: file.deckId })}>Back to library</Link></Button>
        {file.deckId ? <Button asChild variant="outline"><Link {...to.deckEditor(file.deckId)}>Open deck</Link></Button> : null}
      </nav>
      <article className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-t-4 border-t-primary px-6 pb-7 pt-8 sm:px-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Saved results</p>
          <h1 className="break-words font-display text-3xl font-semibold leading-tight sm:text-4xl">{results.title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">Results are kept for 90 days. Download a copy to keep them. This file is available to your account and current members of its space.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void download('report')}>Download report</Button>{file.hasIndividualResponses ? <Button disabled={busy} variant="outline" onClick={() => void download('ballots')}>Download individual responses</Button> : null}<Button disabled={busy} variant="ghost" onClick={() => void download('json')}>Download data</Button></div>
          <p className="mt-3 text-xs text-muted-foreground">Data downloads{file.hasIndividualResponses ? ' and individual responses' : ''} can contain names and hidden entries. Review files before sharing.</p>
          {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
        </header>
        <div className="divide-y divide-border border-t border-border">
          {results.questions.map((question, index) => <section key={index} className="px-6 py-7 sm:px-10">
            <h2 className="whitespace-pre-wrap break-words text-xl font-semibold leading-snug">{question.prompt}</h2>
            {question.rows.length ? <table className="mt-5 w-full table-fixed text-sm"><caption className="sr-only">{question.prompt} — {question.measure}</caption><thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="pb-2 text-left font-normal">{question.measure === 'Summary' ? 'Measure' : 'Answer'}</th><th scope="col" className="w-28 pb-2 text-right font-normal">{question.measure}</th></tr></thead><tbody>{question.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/60 last:border-0"><th scope="row" className="break-words py-3 pr-4 text-left font-normal">{row.label}</th><td className="py-3 text-right font-medium tabular-nums">{number(row.value)}</td></tr>)}</tbody></table> : null}
            {question.entries.length ? <ul className="mt-5 space-y-3">{question.entries.map((entry, entryIndex) => <li key={entryIndex} className="whitespace-pre-wrap break-words border-l-2 border-primary/30 pl-4 text-sm leading-relaxed">{entry}</li>)}</ul> : null}
            {!question.rows.length && !question.entries.length ? <p className="mt-3 text-sm text-muted-foreground">No visible responses were saved for this question.</p> : null}
          </section>)}
          {!results.questions.length ? <p className="px-6 py-8 text-muted-foreground">This deck did not contain questions.</p> : null}
        </div>
      </article>
    </div>
  </main>;
}
