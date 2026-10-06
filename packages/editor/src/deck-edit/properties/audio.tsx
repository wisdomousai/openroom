import { useEffect, useId, useRef, useState } from 'react';
import type { OpenRoomFileResourceV1, OutlineMedia } from '@openroom/schema';
import { AudioPlayer } from '@openroom/slides';
import { ApiError, assetUrl, uploadAsset } from '../../../../../apps/host/src/api';
import { desktopBridge } from '../../../../../apps/host/src/desktop-bridge';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { CommitTextarea, Section } from './shared';

export function AudioSection({ media, spaceId, onChange, onEmbedded }: {
  media: OutlineMedia;
  spaceId?: string | null;
  onChange: (media: OutlineMedia) => void;
  onEmbedded?: (id: string, resource: OpenRoomFileResourceV1) => void;
}) {
  const [address, setAddress] = useState(media.url?.includes('openroom-pending') ? '' : media.url ?? '');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const input = useRef<HTMLInputElement>(null);
  const transcriptId = useId();
  const bridge = desktopBridge();
  const settings = media.listening!;
  const embedded = Boolean(media.resourceId || (media.url?.startsWith('https://local.openroom.invalid/') && !media.url.includes('openroom-pending')));
  const file = async (selected?: File) => {
    setBusy(true); setError(null);
    try {
      const { url: _url, assetId: _asset, resourceId: _resource, ...content } = media;
      if (bridge && onEmbedded) {
        const result = await bridge.pickAudio();
        if (!result || !mounted.current) return;
        onEmbedded(result.resourceId, result.resource);
        onChange({ ...content, url: `https://local.openroom.invalid/${result.resourceId}`, alt: result.resource.name });
      } else if (selected && spaceId) {
        const asset = await uploadAsset(spaceId, selected);
        if (!mounted.current) return;
        if (asset.kind !== 'audio') throw new Error('Choose an audio recording.');
        onChange({ ...content, assetId: asset.id, url: assetUrl(asset.id), alt: asset.name });
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && cause.code === 'unsupported-media-type'
        ? 'Choose an MP3, WAV or M4A recording.'
        : cause instanceof Error ? cause.message : 'The audio could not be added.');
    }
    finally { if (mounted.current) setBusy(false); }
  };
  const commitAddress = () => {
    if (address === media.url) return;
    const url = address.trim();
    if (!/^(https?:\/\/|\/api\/assets\/)/.test(url) || url.length > 2000) { setError('Enter an HTTP or HTTPS audio address.'); return; }
    const { assetId: _asset, resourceId: _resource, ...content } = media;
    setError(null); onChange({ ...content, url });
  };
  return <Section title="Audio" target="image">
    <fieldset disabled={busy} className="grid min-w-0 gap-3">
      {(bridge && onEmbedded) || spaceId ? <Button type="button" variant="outline" onClick={() => bridge && onEmbedded ? void file() : input.current?.click()}>{busy ? 'Adding audio…' : 'Choose audio file'}</Button> : null}
      <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,.mp3,.m4a,.wav" className="hidden" aria-label="Audio file" onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (selected) void file(selected); }} />
      {embedded && !editingAddress ? <div className="grid gap-1"><p className="text-xs text-muted-foreground">Audio saved in this deck.</p><Button variant="ghost" size="sm" onClick={() => { setAddress(''); setEditingAddress(true); }}>Use an audio address</Button></div> : <label className="grid gap-1 text-sm">Audio address<Input value={address} onChange={(event) => setAddress(event.currentTarget.value)} onBlur={commitAddress} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitAddress(); } }} /></label>}
      <label className="grid gap-1 text-sm">Recording label<Input placeholder="A short listening clip" maxLength={500} value={label ?? media.alt} onFocus={() => setLabel(media.alt)} onChange={(event) => setLabel(event.currentTarget.value)} onBlur={() => { if (label !== null) onChange({ ...media, alt: label.trim() }); setLabel(null); }} /></label>
      <div data-editor-target="caption"><CommitTextarea ariaLabel="Caption" value={media.caption ?? ''} onCommit={(caption) => onChange({ ...media, caption: caption || undefined })} /></div>
      <div role="group" aria-label="Listening mode" className="flex flex-wrap gap-1">
        {(['room', 'individual'] as const).map((mode) => <Button key={mode} type="button" size="sm" variant="outline" aria-pressed={settings.mode === mode} onClick={() => onChange({ ...media, listening: { ...settings, mode } })}>{mode === 'room' ? 'Room audio' : 'Individual listening'}</Button>)}
      </div>
      <p className="text-xs text-muted-foreground">Room audio plays from the tutor's device. Individual listening gives learners their own controls.</p>
      <div className="grid gap-1 text-sm"><label htmlFor={transcriptId}>Transcript</label><textarea id={transcriptId} className="min-h-28 rounded-md border border-input bg-background p-2" maxLength={12000} value={transcript ?? settings.transcript ?? ''}
        onFocus={() => setTranscript(settings.transcript ?? '')} onChange={(event) => setTranscript(event.currentTarget.value)}
        onBlur={() => { if (transcript !== null) onChange({ ...media, listening: { ...settings, transcript } }); setTranscript(null); }} /></div>
      <p className="text-xs text-muted-foreground">Hidden from learners until you choose Show transcript while presenting.</p>
      {media.url && !media.url.includes('openroom-pending') ? <AudioPlayer src={media.url} label={`Preview: ${media.alt}`} /> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </Section>;
}
