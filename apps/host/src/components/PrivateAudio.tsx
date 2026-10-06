import { useEffect, useRef, useState } from 'react';
import type { AudioComment } from '@openroom/schema';
import { ApiError, baseUrl, CSRF_HEADERS } from '../api/client';
import { Button } from '@openroom/ui/components/button';
import { useLearnerLanguage } from '../lib/learner-language';
import type { LearnerMessage } from '../lib/learner-copy';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@openroom/ui/components/dialog';

export function audioTime(atMs: number): string {
  const seconds = Math.floor(atMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Audio is fetched with the proper credential; the player only receives a temporary blob URL. */
export function PrivateAudio({ submissionId, available, durationMs, recoverable = false, token, contextId, comments = [], onPosition, onChanged }: {
  submissionId: string; available: boolean; durationMs: number; recoverable?: boolean; token?: string; contextId?: string;
  comments?: AudioComment[]; onPosition?: (atMs: number) => void; onChanged?: () => void | Promise<unknown>;
}) {
  const { copy, locale } = useLearnerLanguage();
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<LearnerMessage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const localUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const seek = useRef<number | null>(null);
  const path = token ? `/api/learner/submissions/${encodeURIComponent(submissionId)}/audio`
    : `/api/tutoring/contexts/${encodeURIComponent(contextId ?? '')}/work/${encodeURIComponent(submissionId)}/audio`;
  useEffect(() => () => { request.current?.abort(); mutation.current?.abort(); if (localUrl.current) URL.revokeObjectURL(localUrl.current); }, []);
  useEffect(() => {
    if (!available) { request.current?.abort(); player.current?.pause(); if (localUrl.current) URL.revokeObjectURL(localUrl.current); localUrl.current = null; setSource(null); }
  }, [available]);
  const fetchAudio = async (method = 'GET') => {
    const controller = new AbortController();
    // An availability refresh may cancel playback, never an in-flight restore.
    if (method === 'GET') request.current = controller; else mutation.current = controller;
    const response = await fetch(`${baseUrl}${path}`, { method, signal: controller.signal,
      credentials: token ? 'omit' : 'same-origin', headers: token ? { authorization: `Bearer ${token}` } : method !== 'GET' ? CSRF_HEADERS : {} });
    if (!response.ok) throw new ApiError(response.status, 'Recording unavailable');
    return response;
  };
  const listen = async (atMs?: number) => {
    if (source && player.current) { if (atMs !== undefined) player.current.currentTime = atMs / 1000; void player.current.play().catch(() => {}); return; }
    setBusy(true); setError(null); seek.current = atMs ?? null;
    try {
      const blob = await (await fetchAudio()).blob();
      if (request.current?.signal.aborted) return;
      const url = URL.createObjectURL(blob); localUrl.current = url; setSource(url);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof ApiError && cause.status === 410 ? 'recordingUnavailable' : 'recordingLoadError');
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      await fetchAudio('DELETE'); player.current?.pause();
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      localUrl.current = null; setSource(null); setRemoved(true); setConfirm(false); await onChanged?.();
    } catch { setError('recordingRemoveError'); } finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError(null);
    try { await fetchAudio('PATCH'); setRemoved(false); await onChanged?.(); }
    catch { setError('recordingRestoreError'); }
    finally { setBusy(false); }
  };
  const playable = available && !removed;
  return <div className="grid min-w-0 gap-3">
    {playable ? <>
      {source ? <audio ref={player} src={source} controls aria-label={copy.voiceResponse} className="h-12 w-full min-w-0" onTimeUpdate={() => onPosition?.(Math.min(durationMs, Math.round((player.current?.currentTime ?? 0) * 1000)))} onLoadedMetadata={() => { if (seek.current !== null && player.current) { player.current.currentTime = seek.current / 1000; void player.current.play().catch(() => {}); seek.current = null; } }} /> : <Button type="button" variant="outline" className="min-h-11 w-fit" disabled={busy} onClick={() => void listen()}>{busy ? copy.loadingRecording : copy.listen(audioTime(durationMs))}</Button>}
      <Button type="button" variant="ghost" className="min-h-11 w-fit text-muted-foreground" disabled={busy} onClick={() => setConfirm(true)}>{copy.removeRecording}</Button>
    </> : <p className="text-sm text-muted-foreground">{copy.removedFeedbackRemains}</p>}
    {recoverable || removed ? <Button type="button" variant="outline" className="min-h-11 w-fit" disabled={busy} onClick={() => void restore()}>{copy.restoreRecording}</Button> : null}
    {comments.map((note, index) => <div key={index} className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
      {playable ? <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={() => void listen(note.atMs)} aria-label={copy.listenAt(audioTime(note.atMs))}>{audioTime(note.atMs)}</Button> : <span className="font-mono text-sm">{audioTime(note.atMs)}</span>}
      <p className="whitespace-pre-wrap text-base leading-relaxed">{note.comment}</p>
    </div>)}
    {error ? <p role="alert" className="text-sm text-destructive">{copy[error]}</p> : null}
    <Dialog open={confirm} onOpenChange={(open) => { if (!busy) setConfirm(open); }}><DialogContent closeLabel={copy.close} lang={locale}><DialogHeader><DialogTitle>{copy.removeQuestion}</DialogTitle><DialogDescription>{copy.removeExplanation}</DialogDescription></DialogHeader><DialogFooter className="flex-wrap"><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>{copy.keepRecording}</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{copy.trashAudio}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
