import { useEffect, useRef, useState } from 'react';
import type { OpenRoomFileResourceV1, SlideImageSource } from '@openroom/schema';
import { assetUrl, uploadAsset } from '../../../../../apps/host/src/api';
import { desktopBridge } from '../../../../../apps/host/src/desktop-bridge';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';

/** A design image uses the same local import or space upload as slide content. */
export function DesignImagePicker({ label, value, spaceId, onEmbedded, onChange }: {
  label: 'Background' | 'Logo';
  value?: SlideImageSource;
  spaceId?: string | null;
  onEmbedded?: (id: string, resource: OpenRoomFileResourceV1) => void;
  onChange: (source: SlideImageSource) => void;
}) {
  const bridge = desktopBridge();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const latest = useRef({ onChange, onEmbedded });
  latest.current = { onChange, onEmbedded };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const embedded = Boolean(value?.resourceId || value?.url?.startsWith('https://local.openroom.invalid/'));
  const uploaded = Boolean(value?.assetId);
  const choose = async (file?: File) => {
    setBusy(true); setError(null);
    try {
      let source: SlideImageSource;
      if (bridge && onEmbedded) {
        const picked = await bridge.pickImage();
        if (!picked || !mounted.current) return;
        latest.current.onEmbedded?.(picked.resourceId, picked.resource);
        source = { url: `https://local.openroom.invalid/${picked.resourceId}` };
      } else {
        if (!file || !spaceId) return;
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
          throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');
        }
        const asset = await uploadAsset(spaceId, file);
        if (asset.kind !== 'image') throw new Error('Choose an image.');
        source = { assetId: asset.id, url: assetUrl(asset.id) };
      }
      if (!mounted.current) return;
      latest.current.onChange(source); setAddress(null);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The image could not be added.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const showAddress = address !== null || (!embedded && !uploaded);
  const commitAddress = () => {
    const url = (address ?? value?.url ?? '').trim();
    try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(); }
    catch { setError('Enter an HTTPS image address.'); return; }
    setError(null); onChange({ url }); setAddress(null);
  };
  return <fieldset disabled={busy} className="grid min-w-0 gap-2">
    {value?.url ? <img src={value.url} alt={`${label} preview`} className="h-24 w-full rounded border border-border bg-muted object-contain" /> : null}
    {(bridge && onEmbedded) || spaceId ? <Button variant="outline" size="sm" onClick={() => bridge && onEmbedded ? void choose() : input.current?.click()}>{busy ? 'Adding image…' : `Choose ${label.toLowerCase()} image`}</Button> : null}
    <input ref={input} type="file" className="hidden" aria-label={`${label} image file`} accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={(event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void choose(file);
    }} />
    {embedded ? <p className="text-xs text-muted-foreground">Image saved in this deck.</p> : null}
    {uploaded ? <p className="text-xs text-muted-foreground">Image saved in this space.</p> : null}
    {showAddress ? <>
      <label className="grid gap-1 text-sm">{label} image address<Input type="url" value={address ?? value?.url ?? ''} placeholder="https://…" onChange={(event) => setAddress(event.currentTarget.value)} /></label>
      <Button size="sm" variant="outline" onClick={commitAddress}>Use {label.toLowerCase()} image</Button>
    </> : <Button size="sm" variant="ghost" onClick={() => setAddress('')}>Use an image address</Button>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </fieldset>;
}
