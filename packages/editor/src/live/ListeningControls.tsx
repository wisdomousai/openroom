import { useState } from 'react';
import { AudioPlayer } from '@openroom/slides';
import type { OutlineMedia } from '@openroom/schema';
import { Button } from '@openroom/ui/components/button';

export interface ListeningSettings { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean }
type ListeningChange = Pick<ListeningSettings, 'stepId'> & Partial<Omit<ListeningSettings, 'stepId'>>;

/** Room audio comes from this console, never from its mirrored or external stage. */
export function ListeningControls({ media, value, onChange, disabled = false }: {
  disabled?: boolean;
  media: OutlineMedia;
  value: ListeningSettings;
  onChange: (change: ListeningChange) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (patch: Omit<ListeningChange, 'stepId'>) => {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try { if (!await onChange({ stepId: value.stepId, ...patch })) setError('Listening settings could not be changed. Try again.'); }
    catch { setError('Listening settings could not be changed. Try again.'); }
    finally { setBusy(false); }
  };
  const ready = media.url && !media.url.includes('openroom-pending');
  return <section aria-label="Listening controls" className="mx-auto grid w-full max-w-4xl gap-3 border-t border-border bg-card p-4">
    <div className="flex flex-wrap items-center gap-3">
      <strong className="text-row-title">Listening</strong>
      <div role="group" aria-label="Listening mode" className="flex gap-1">
        {/* The chosen mode carries a check as well as the selected fill, so it does not rest on colour. */}
        {(['room', 'individual'] as const).map((mode) => {
          const selected = value.mode === mode;
          return <Button key={mode} size="sm" variant="outline" aria-pressed={selected} disabled={busy || disabled}
            className={selected ? 'bg-accent font-semibold hover:bg-accent' : undefined}
            onClick={() => void update({ mode })}><span className={selected ? 'text-accent-foreground' : undefined}>{selected ? <span aria-hidden="true">✓ </span> : null}{mode === 'room' ? 'Room audio' : 'Individual listening'}</span></Button>;
        })}
      </div>
      {/* The label names the action it takes, so it carries no pressed state as well. */}
      {media.listening?.transcript ? <Button size="sm" variant="outline" disabled={busy || disabled}
        onClick={() => void update({ transcriptShown: !value.transcriptShown })}>{value.transcriptShown ? 'Hide transcript' : 'Show transcript'}</Button> : null}
    </div>
    <p className="text-caption text-muted-foreground">{value.mode === 'room' ? 'Play from this device. The projector and learner devices stay silent.' : 'Learners control playback on their own devices. Room playback is off.'}</p>
    {!disabled && value.mode === 'room' && ready ? <AudioPlayer key={`${value.stepId}:${media.url}`} src={media.url!} label={media.alt} /> : null}
    {!ready ? <p className="text-secondary">Choose an audio file or address in the deck editor.</p> : null}
    {media.listening?.transcript ? <details className="text-secondary"><summary className="cursor-pointer">Private transcript</summary><p className="max-h-28 overflow-y-auto whitespace-pre-wrap pt-2">{media.listening.transcript}</p></details> : null}
    {error ? <p role="alert" className="text-secondary text-destructive">{error}</p> : null}
  </section>;
}
