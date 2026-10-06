import { useEffect, useRef, useState } from 'react';
import type { OpenRoomFileResourceV1, OutlineMedia } from '@openroom/schema';

import { ApiError, listAssets, searchStock, uploadAsset, assetUrl, type StockHit, type MediaAssetSummary } from '../../../../apps/host/src/api';
import { Button } from '@openroom/ui/components/button';
import { Checkbox } from '@openroom/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { Input } from '@openroom/ui/components/input';
import { cn } from '@openroom/ui/utils';
import { desktopBridge } from '../../../../apps/host/src/desktop-bridge';

type PictureTab = 'computer' | 'stock' | 'space' | 'upload' | 'link';

/**
 * Choose a picture — a dialog, because a search box and a photo grid do not
 * fit the task pane (Pane-or-Dialog Rule).
 */
export function PictureDialog({
  open,
  spaceId,
  selectedUrl,
  onOpenChange,
  onInsert,
  onEmbedded,
}: {
  open: boolean;
  spaceId: string | null;
  selectedUrl?: string;
  onOpenChange: (open: boolean) => void;
  onInsert: (media: OutlineMedia, credit: boolean) => void;
  onEmbedded?: (resourceId: string, resource: OpenRoomFileResourceV1) => void;
}) {
  const bridge = desktopBridge();
  const [tab, setTab] = useState<PictureTab>(bridge === null ? 'stock' : 'computer');
  const [pending, setPending] = useState<OutlineMedia | null>(null);
  const [credit, setCredit] = useState(true);

  useEffect(() => {
    if (!open) {
      setPending(null);
      setTab(bridge === null ? 'stock' : 'computer');
    }
  }, [bridge, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="picture-dialog-copy"
        className="flex h-[min(40rem,calc(100svh-5rem))] w-[min(53.75rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="px-6 pb-2 pt-5">
          <DialogTitle>Choose a picture</DialogTitle>
          <DialogDescription id="picture-dialog-copy">
            Search, upload, or paste a link. Insert puts it on this slide.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-0.5 px-6 pb-3.5">
          {(
            [
              ...(bridge === null ? [] : [{ id: 'computer', label: 'This computer' }] as const),
              { id: 'stock', label: 'Stock photos' },
              { id: 'space', label: 'This space' },
              { id: 'upload', label: 'Upload' },
              { id: 'link', label: 'From a link' },
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'inline-flex h-8 items-center rounded-md px-3.5 text-secondary',
                tab === entry.id
                  ? 'bg-accent font-semibold text-accent-foreground'
                  : 'hover:bg-chrome',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          {tab === 'computer' && bridge !== null ? (
            <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-border p-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <p className="text-secondary">The picture is copied into this deck and travels with the .openroom file.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void bridge.pickImage().then((embedded) => {
                      if (embedded === null) return;
                      onEmbedded?.(embedded.resourceId, embedded.resource);
                      setPending({
                        type: 'image',
                        url: `https://local.openroom.invalid/${encodeURIComponent(embedded.resourceId)}`,
                        alt: embedded.resource.name,
                      });
                      setCredit(false);
                    });
                  }}
                >
                  Choose picture…
                </Button>
              </div>
            </div>
          ) : tab === 'stock' ? (
            <StockGrid
              selectedUrl={pending?.url ?? selectedUrl}
              onPick={(hit) => {
                setPending({
                  type: 'image',
                  url: hit.imageUrl,
                  alt: hit.tags.split(',')[0]?.trim() || 'Photo from Pixabay',
                  caption: `Photo by ${hit.user} on Pixabay`,
                });
              }}
            />
          ) : tab === 'space' ? (
            <SpaceGrid
              spaceId={spaceId}
              selectedUrl={pending?.url ?? selectedUrl}
              onPick={(asset) => {
                if (asset.kind === 'pdf') return;
                setPending({
                  type: asset.kind,
                  ...(asset.kind === 'audio' ? { listening: { mode: 'room' as const } } : {}),
                  assetId: asset.id,
                  url: assetUrl(asset.id),
                  alt: asset.alt ?? asset.name,
                });
              }}
            />
          ) : tab === 'upload' ? (
            <UploadPane
              spaceId={spaceId}
              onPick={(media) => setPending(media)}
            />
          ) : (
            <LinkPane onPick={(media) => setPending(media)} />
          )}
        </div>
        <DialogFooter>
          <label className="mr-auto flex min-w-0 items-center gap-2 text-secondary">
            <Checkbox checked={credit} onCheckedChange={(next) => setCredit(next === true)} />
            Credit the photographer on the slide
          </label>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending === null}
            onClick={() => {
              if (pending === null) return;
              onInsert(pending, credit);
              onOpenChange(false);
            }}
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockGrid({
  selectedUrl,
  onPick,
}: {
  selectedUrl?: string;
  onPick: (hit: StockHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StockHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 1) return;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void searchStock(q, 1)
        .then((body) => {
          setHits(body.hits);
          setProblem(null);
        })
        .catch((error: unknown) => {
          setHits([]);
          setProblem(error instanceof ApiError ? error.message : 'Pixabay could not be reached.');
        })
        .finally(() => setBusy(false));
    }, q.length === 0 ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search photos"
        aria-label="Search stock photos"
      />
      {problem === null ? null : (
        <p className="text-caption text-destructive" role="alert">{problem}</p>
      )}
      <div className="grid grid-cols-4 gap-3">
        {hits.map((hit) => {
          const selected = selectedUrl === hit.imageUrl;
          return (
            <button
              key={hit.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(hit)}
              className={cn(
                'relative aspect-[4/3] overflow-hidden rounded-lg bg-muted',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                selected ? 'outline outline-2 -outline-offset-2 outline-primary' : 'hover:outline hover:outline-2 hover:outline-primary',
              )}
            >
              <img src={hit.previewUrl} alt="" className="size-full object-cover" />
            </button>
          );
        })}
      </div>
      {busy && hits.length === 0 ? (
        <p className="text-caption text-muted-foreground">Loading photos…</p>
      ) : null}
    </div>
  );
}

function SpaceGrid({
  spaceId,
  selectedUrl,
  onPick,
}: {
  spaceId: string | null;
  selectedUrl?: string;
  onPick: (asset: MediaAssetSummary) => void;
}) {
  const [assets, setAssets] = useState<MediaAssetSummary[]>([]);
  useEffect(() => {
    if (spaceId === null) return;
    void listAssets(spaceId, '').then(setAssets).catch(() => setAssets([]));
  }, [spaceId]);
  if (spaceId === null) {
    return <p className="text-caption text-muted-foreground">No space open to read files from yet.</p>;
  }
  if (assets.length === 0) {
    return <p className="text-caption text-muted-foreground">Nothing uploaded in this space yet.</p>;
  }
  return (
    <div className="grid grid-cols-4 gap-3">
      {assets.map((asset) => {
        const url = assetUrl(asset.id);
        const selected = selectedUrl === url;
        return (
          <button
            key={asset.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(asset)}
            className={cn(
              'relative aspect-[4/3] overflow-hidden rounded-lg bg-muted',
              selected ? 'outline outline-2 -outline-offset-2 outline-primary' : 'hover:outline hover:outline-2 hover:outline-primary',
            )}
          >
            {asset.kind === 'image' ? (
              <img src={url} alt={asset.alt ?? asset.name} className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-caption text-muted-foreground">Video</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function UploadPane({
  spaceId,
  onPick,
}: {
  spaceId: string | null;
  onPick: (media: OutlineMedia) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (file === undefined) return;
    if (spaceId === null) {
      setProblem('No space to upload into.');
      return;
    }
    setBusy(true);
    try {
      const asset = await uploadAsset(spaceId, file);
      if (asset.kind === 'pdf') throw new Error('Choose an image, video, or audio file.');
      onPick({
        type: asset.kind,
        ...(asset.kind === 'audio' ? { listening: { mode: 'room' as const } } : {}),
        assetId: asset.id,
        url: assetUrl(asset.id),
        alt: asset.alt ?? asset.name,
      });
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'The upload did not finish.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="rounded-lg border border-dashed border-input px-4 py-8 text-secondary text-muted-foreground hover:bg-background"
      >
        {busy ? 'Working…' : 'Drop or click to upload. Max 20 MB.'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          void upload(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      {problem === null ? null : <p className="text-caption text-destructive">{problem}</p>}
    </div>
  );
}

function LinkPane({ onPick }: { onPick: (media: OutlineMedia) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        placeholder="https://…"
        aria-label="Picture address"
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <Button
        type="button"
        onClick={() => {
          const url = value.trim();
          if (url === '') return;
          onPick({ type: 'image', url, alt: 'Picture from a link' });
        }}
      >
        Use
      </Button>
    </div>
  );
}
