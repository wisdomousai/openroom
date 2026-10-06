import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { encodeVoiceWav, VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE, VOICE_SOURCE_MAX_BYTES } from '@openroom/schema';
import { ApiError, uploadLearnerVoice, type LearnerHomeworkTask } from '../../api';
import { PrivateAudio, audioTime } from '../../components/PrivateAudio';
import { Button } from '../../components/ui/button';
import { useLearnerLanguage } from '../../lib/learner-language';
import type { LearnerMessage } from '../../lib/learner-copy';

class AudioPreparationError extends Error {
  constructor(readonly messageKey: LearnerMessage) { super(messageKey); }
}

async function prepareAudio(blob: Blob, recorded: boolean): Promise<Blob> {
  if (!blob.size || blob.size > VOICE_SOURCE_MAX_BYTES) throw new AudioPreparationError('audioTooLarge');
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.duration || (!recorded && decoded.duration > VOICE_MAX_SECONDS)) throw new AudioPreparationError('audioTooLong');
    const length = Math.min(Math.ceil(decoded.duration * VOICE_SAMPLE_RATE), VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE);
    const renderer = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
    const source = renderer.createBufferSource(); source.buffer = decoded; source.connect(renderer.destination); source.start();
    const rendered = await renderer.startRendering();
    return new Blob([encodeVoiceWav(rendered.getChannelData(0)) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
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
  const [error, setError] = useState<LearnerMessage | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const upload = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(active); activeRef.current = active;
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; stop(); upload.current?.abort(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => { setSent(task.audio); }, [task.audio]);
  useEffect(() => {
    if (!audio) { setPreview(null); return; }
    const url = URL.createObjectURL(audio); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  useEffect(() => {
    if (!recording) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - start) / 1000); setSeconds(Math.min(elapsed, VOICE_MAX_SECONDS));
      if (elapsed >= VOICE_MAX_SECONDS) stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  const prepare = async (blob: Blob, recorded = false) => {
    setPreparing(true); setError(null);
    try {
      const wav = await prepareAudio(blob, recorded);
      if (mounted.current) { setAudio(wav); setSubmissionId(crypto.randomUUID()); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof AudioPreparationError ? cause.messageKey : 'audioOpenError');
    } finally { if (mounted.current) setPreparing(false); }
  };
  const record = async () => {
    setError(null); setPreparing(true);
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || !activeRef.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
      const media = new MediaRecorder(input); recorder.current = media;
      const chunks: Blob[] = []; let failed = false; let size = 0;
      media.ondataavailable = (event) => {
        size += event.data.size;
        if (size > VOICE_SOURCE_MAX_BYTES) { failed = true; stop(); setError('recordingTooLarge'); }
        else if (event.data.size) chunks.push(event.data);
      };
      media.onerror = () => { failed = true; stop(); setError('recordingStopped'); };
      media.onstop = () => {
        input.getTracks().forEach((track) => track.stop()); recorder.current = null;
        if (!mounted.current) return;
        setRecording(false);
        if (!failed) void prepare(new Blob(chunks, { type: media.mimeType }), true);
      };
      media.start(1000); setSeconds(0); setRecording(true); setAudio(null);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) setError('microphoneUnavailable');
    } finally { if (mounted.current) setPreparing(false); }
  };
  const send = async () => {
    if (!audio) return;
    setUploading(true); setError(null);
    const controller = new AbortController(); upload.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const saved = await uploadLearnerVoice(token, { sessionId, taskId: task.id, submissionId, assignmentRevision: task.assignmentRevision! }, audio, controller.signal);
      setSent({ ...saved, available: true }); setAudio(null);
      void queryClient.invalidateQueries({ queryKey: ['learner', 'sessions'] });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && cause.code === 'recording-limit' ? 'recordingLimit' : cause instanceof ApiError && cause.status === 409 ? 'voiceChanged' : 'voiceSendError');
    } finally { window.clearTimeout(timeout); if (mounted.current) setUploading(false); }
  };
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const busy = preparing || uploading || recording;
  return <section className="grid min-w-0 gap-3" aria-label={task.title ?? copy.voiceResponse}>
    <h3 className="font-semibold">{task.title ?? copy.voiceResponse}</h3>
    <p className="whitespace-pre-wrap text-base">{task.prompt}</p>
    {task.guidance ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.guidance}</p> : null}
    {sent ? <div className="grid gap-2 rounded-lg border border-border p-3"><p className="text-sm font-medium" role="status">{copy.responseSent}</p><PrivateAudio key={sent.submissionId} {...sent} token={token} onChanged={() => queryClient.invalidateQueries({ queryKey: ['learner'] })} /></div> : null}
    <div className="flex flex-wrap items-center gap-2">
      {recording ? <><Button type="button" className="min-h-11" onClick={stop}>{copy.stopRecording}</Button><span role="timer" aria-label={copy.recordingTime} className="font-mono">{audioTime(seconds * 1000)} / 5:00</span></> : canRecord ? <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void record()}>{audio ? copy.recordAgain : sent ? copy.recordAnother : copy.recordResponse}</Button> : null}
      <label className={`relative inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-medium focus-within:ring-2 focus-within:ring-ring ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-accent'}`}>
        {copy.chooseFile}<input type="file" accept="audio/*" aria-label={copy.chooseFile} disabled={busy} className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void prepare(file); }} />
      </label>
    </div>
    {preparing ? <p role="status" className="text-sm">{copy.preparing}</p> : null}
    {preview ? <div className="grid min-w-0 gap-3"><audio src={preview} controls aria-label={copy.preview} className="h-12 w-full min-w-0" /><div className="flex flex-wrap items-center gap-3"><Button type="button" className="min-h-11" disabled={busy} onClick={() => void send()}>{copy.sendResponse}</Button><a href={preview} download="my-response.wav" className="inline-flex min-h-11 items-center text-sm underline">{copy.download}</a></div></div> : null}
    {uploading ? <div role="status" className="grid gap-1"><label htmlFor={`voice-progress-${task.id}`} className="text-sm">{copy.sending}</label><progress id={`voice-progress-${task.id}`}  className="w-full" /></div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{copy[error]}</p> : null}
    <p className="text-xs leading-relaxed text-muted-foreground">{copy.voicePrivacy}</p>
  </section>;
}
