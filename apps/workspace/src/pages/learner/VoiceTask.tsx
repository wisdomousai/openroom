import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { encodeVoiceWav, VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE, VOICE_SOURCE_MAX_BYTES } from '@openroom/schema';
import { ApiError, uploadLearnerVoice, type LearnerHomeworkTask } from '../../api';
import { PrivateAudio, audioTime } from '../../components/PrivateAudio';
import { Button } from '@openroom/ui/components/button';
import { useLearnerLanguage } from '../../lib/learner-language';
import type { LearnerMessage, RecordingStopReason } from '../../lib/learner-copy';

class AudioPreparationError extends Error {
  constructor(readonly messageKey: LearnerMessage) { super(messageKey); }
}

/**
 * Upload time allowed for a recording: one minute plus the time its bytes take
 * at 250 kbit/s, so a five-minute take (about 9.6 MB) still fits a slow
 * mobile uplink instead of failing at the same fixed limit on every retry.
 */
function voiceUploadTimeoutMs(bytes: number): number {
  return 60_000 + Math.ceil((bytes * 8) / 250_000) * 1000;
}

async function prepareAudio(blob: Blob, recorded: boolean): Promise<{ wav: Blob; durationMs: number }> {
  if (!blob.size || blob.size > VOICE_SOURCE_MAX_BYTES) throw new AudioPreparationError('audioTooLarge');
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.duration || (!recorded && decoded.duration > VOICE_MAX_SECONDS)) throw new AudioPreparationError('audioTooLong');
    const length = Math.min(Math.ceil(decoded.duration * VOICE_SAMPLE_RATE), VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE);
    const renderer = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
    const source = renderer.createBufferSource(); source.buffer = decoded; source.connect(renderer.destination); source.start();
    const rendered = await renderer.startRendering();
    const wav = new Blob([encodeVoiceWav(rendered.getChannelData(0)) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
    return { wav, durationMs: Math.round((length / VOICE_SAMPLE_RATE) * 1000) };
  } finally { await decoder.close(); }
}

export function VoiceTask({ token, sessionId, task, active }: { token: string; sessionId: string; task: LearnerHomeworkTask; active: boolean }) {
  const { copy } = useLearnerLanguage();
  const queryClient = useQueryClient();
  const [audio, setAudio] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState(task.audio);
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sendSeconds, setSendSeconds] = useState(0);
  const [error, setError] = useState<LearnerMessage | null>(null);
  // Set when the recorder ended without the learner's Stop; shown beside the preview.
  const [cutShort, setCutShort] = useState<{ reason: RecordingStopReason; durationMs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // Why the current recording is being stopped. An onstop without one means the microphone ended it.
  const stopReason = useRef<RecordingStopReason | 'learner' | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const upload = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(active); activeRef.current = active;
  /*
   * Record, Stop and Send each replace or disable the pressed button, so focus
   * moves on: to Stop once recording runs, to Send once the take is ready
   * (Record if it could not be prepared), and to Response sent after sending.
   */
  const focusAfter = useRef<'stop' | 'send' | 'sent' | null>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const sentStatus = useRef<HTMLParagraphElement>(null);
  const stop = (reason: RecordingStopReason | 'learner') => {
    if (recorder.current?.state === 'recording') { stopReason.current ??= reason; recorder.current.stop(); }
    stream.current?.getTracks().forEach((track) => track.stop());
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) stop('hidden'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; stop('learner'); upload.current?.abort(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!active) stop('tab'); }, [active]);
  useEffect(() => { setSent(task.audio); }, [task.audio]);
  useEffect(() => {
    if (!audio) { setPreview(null); return; }
    const url = URL.createObjectURL(audio); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  useEffect(() => {
    const want = focusAfter.current;
    // Wait while the recorder stops, the take is prepared or sent, or its preview is not drawn yet.
    if (!want || preparing || uploading || (audio && !preview) || (want === 'send' && recording)) return;
    focusAfter.current = null;
    if (want === 'stop' && recording) stopButton.current?.focus();
    else if (want === 'sent' && sent && !audio) sentStatus.current?.focus();
    else (preview ? sendButton : recordButton).current?.focus();
  }, [recording, preparing, uploading, audio, preview, sent]);
  useEffect(() => {
    if (!recording) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - start) / 1000); setSeconds(Math.min(elapsed, VOICE_MAX_SECONDS));
      if (elapsed >= VOICE_MAX_SECONDS) stop('limit');
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!uploading) return;
    const start = performance.now(); setSendSeconds(0);
    const timer = window.setInterval(() => setSendSeconds(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [uploading]);
  const prepare = async (blob: Blob, recorded = false, stoppedBy: RecordingStopReason | null = null) => {
    setPreparing(true); setError(null); setCutShort(null);
    try {
      const { wav, durationMs } = await prepareAudio(blob, recorded);
      if (mounted.current) { setAudio(wav); setSubmissionId(crypto.randomUUID()); if (stoppedBy) setCutShort({ reason: stoppedBy, durationMs }); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof AudioPreparationError ? cause.messageKey : 'audioOpenError');
    } finally { if (mounted.current) setPreparing(false); }
  };
  const record = async () => {
    focusAfter.current = 'stop'; setError(null); setCutShort(null); setPreparing(true);
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || !activeRef.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input; stopReason.current = null;
      const media = new MediaRecorder(input); recorder.current = media;
      const chunks: Blob[] = []; let failed = false; let size = 0;
      media.ondataavailable = (event) => {
        size += event.data.size;
        if (size > VOICE_SOURCE_MAX_BYTES) { failed = true; stop('learner'); setError('recordingTooLarge'); }
        else if (event.data.size) chunks.push(event.data);
      };
      media.onerror = () => { failed = true; stop('learner'); setError('recordingStopped'); };
      media.onstop = () => {
        if (document.activeElement === stopButton.current) focusAfter.current = 'send';
        input.getTracks().forEach((track) => track.stop()); recorder.current = null;
        const reason = stopReason.current ?? 'device'; stopReason.current = null;
        if (!mounted.current) return;
        setRecording(false);
        if (!failed) void prepare(new Blob(chunks, { type: media.mimeType }), true, reason === 'learner' ? null : reason);
      };
      media.start(1000); setSeconds(0); setRecording(true); setAudio(null);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) setError('microphoneUnavailable');
    } finally { if (mounted.current) setPreparing(false); }
  };
  const send = async () => {
    if (!audio) return;
    focusAfter.current = 'sent'; setUploading(true); setError(null);
    const controller = new AbortController(); upload.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, voiceUploadTimeoutMs(audio.size));
    try {
      const saved = await uploadLearnerVoice(token, { sessionId, taskId: task.id, submissionId, assignmentRevision: task.assignmentRevision! }, audio, controller.signal);
      setSent({ ...saved, available: true }); setAudio(null); setCutShort(null);
      void queryClient.invalidateQueries({ queryKey: ['learner', 'sessions'] });
    } catch (cause) {
      if (mounted.current) setError(timedOut ? 'voiceSendTimeout' : cause instanceof ApiError && cause.code === 'recording-limit' ? 'recordingLimit' : cause instanceof ApiError && cause.status === 409 ? 'voiceChanged' : 'voiceSendError');
    } finally { window.clearTimeout(timeout); if (mounted.current) setUploading(false); }
  };
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const busy = preparing || uploading || recording;
  return <section className="grid min-w-0 gap-3" aria-label={task.title ?? copy.voiceResponse}>
    <h3 className="font-semibold">{task.title ?? copy.voiceResponse}</h3>
    <p className="whitespace-pre-wrap text-base">{task.prompt}</p>
    {task.guidance ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.guidance}</p> : null}
    {sent ? <div className="grid gap-2 rounded-lg border border-border p-3"><p ref={sentStatus} tabIndex={-1} className="text-sm font-medium outline-none" role="status">{copy.responseSent}</p><PrivateAudio key={sent.submissionId} {...sent} token={token} onChanged={() => queryClient.invalidateQueries({ queryKey: ['learner'] })} /></div> : null}
    <div className="flex flex-wrap items-center gap-2">
      {recording ? <><Button ref={stopButton} type="button" className="min-h-11" onClick={() => stop('learner')}>{copy.stopRecording}</Button><span role="timer" aria-label={copy.recordingTime} className="font-mono">{audioTime(seconds * 1000)} / 5:00</span></> : canRecord ? <Button ref={recordButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void record()}>{audio ? copy.recordAgain : sent ? copy.recordAnother : copy.recordResponse}</Button> : null}
      <label className={`relative inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-medium focus-within:ring-2 focus-within:ring-ring ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-accent'}`}>
        {copy.chooseFile}<input type="file" accept="audio/*" aria-label={copy.chooseFile} disabled={busy} className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void prepare(file); }} />
      </label>
    </div>
    {preparing ? <p role="status" className="text-sm">{copy.preparing}</p> : null}
    {preview && cutShort ? <p role="status" className="text-sm">{copy.recordingCutShort(audioTime(cutShort.durationMs), cutShort.reason)}</p> : null}
    {preview ? <div className="grid min-w-0 gap-3"><audio src={preview} controls aria-label={copy.preview} className="h-12 w-full min-w-0" /><div className="flex flex-wrap items-center gap-3"><Button ref={sendButton} type="button" className="min-h-11" disabled={busy} onClick={() => void send()}>{copy.sendResponse}</Button><a href={preview} download="my-response.wav" className="inline-flex min-h-11 items-center text-sm underline">{copy.download}</a></div></div> : null}
    {uploading ? <div className="grid gap-1"><div className="flex items-baseline justify-between gap-3"><span role="status"><label htmlFor={`voice-progress-${task.id}`} className="text-sm">{copy.sending}</label></span><span role="timer" aria-label={copy.sendingTime} className="font-mono text-sm tabular-nums">{audioTime(sendSeconds * 1000)}</span></div><progress id={`voice-progress-${task.id}`} className="w-full" /></div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{copy[error]}</p> : null}
    <p className="text-xs leading-relaxed text-muted-foreground">{copy.voicePrivacy}</p>
  </section>;
}
