import { useEffect, useRef, useState } from 'react';
import type { OpenRoomFileResourceV1, OutlineMedia } from '@openroom/schema';

import type { MediaAssetSummary } from '@openroom/schema';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@openroom/ui/components/tabs';
import { cn } from '@openroom/ui/utils';
import { isServiceError, useEditorServices, type StockHit } from '../services';
import { mediaLabelFromFileName } from './media-label';

type PictureTab = 'computer' | 'stock' | 'space' | 'upload' | 'link';

/**
 * A stock or linked picture is an address, not a file in the space, so Save a
 * copy cannot pack it. Said where the picture is chosen, not only when the copy
 * fails.
 */
export const ONLINE_PICTURE_NOTE =
  'This picture stays online. Upload it into this space before you use Save a copy.';

/** A failure worth retrying as it is: offline, busy or a server fault. */
function retriable(error: unknown): boolean {
  return isServiceError(error) && (error.status === 0 || error.status === 429 || error.status >= 500);
}

/**
 * A still picture starts with empty alt text: a file name or a search tag
 * does not say what the picture shows. The Picture pane asks for it.
 *
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
  /** False when the picture had nowhere to go; the dialog then stays open and says so. */
  onInsert: (media: OutlineMedia, credit: boolean) => boolean;
  onEmbedded?: (resourceId: string, resource: OpenRoomFileResourceV1) => void;
}) {
  const { desktop: bridge, assets } = useEditorServices();
  const [tab, setTab] = useState<PictureTab>(bridge === null ? 'stock' : 'computer');
  const [pending, setPending] = useState<OutlineMedia | null>(null);
  const [credit, setCredit] = useState(true);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!open) {
      setPending(null);
      setRefused(false);
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
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as PictureTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-5 pb-2.5">
            <TabsList
              aria-label="Where the picture comes from"
              className="flex h-auto w-full justify-start gap-0.5 overflow-x-auto bg-transparent p-1"
            >
              {(
                [
                  ...(bridge === null ? [] : [{ id: 'computer', label: 'This computer' }] as const),
                  { id: 'stock', label: 'Stock photos' },
                  { id: 'space', label: 'This space' },
                  { id: 'upload', label: 'Upload' },
                  { id: 'link', label: 'From a link' },
                ] as const
              ).map((entry) => (
                <TabsTrigger
                  key={entry.id}
                  value={entry.id}
                  className="h-8 shrink-0 px-3.5 hover:bg-chrome data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
                >
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value={tab} className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pb-5">
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
                          alt: '',
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
                    alt: '',
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
                    url: assets.url(asset.id),
                    // A recording or a video is named by its label; a still picture's alt starts empty.
                    alt: asset.alt ?? (asset.kind === 'image' ? '' : mediaLabelFromFileName(asset.name)),
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
            {tab === 'stock' || tab === 'link' ? (
              <p className="pt-3 text-caption text-muted-foreground" data-picture-online-note>
                {ONLINE_PICTURE_NOTE}
              </p>
            ) : null}
          </TabsContent>
        </Tabs>
        {refused ? (
          <div className="px-6 pb-3">
            <Problem text={NO_PLACE_FOR_PICTURE} />
          </div>
        ) : null}
        <DialogFooter flush>
          <label className="mr-auto flex min-w-0 items-center gap-2 text-secondary">
            <Checkbox checked={credit} onCheckedChange={(next) => setCredit(next === true)} />
            <span className="truncate" title="Credit the photographer on the slide">
              Credit the photographer on the slide
            </span>
          </label>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending === null}
            onClick={() => {
              if (pending === null) return;
              if (!onInsert(pending, credit)) {
                setRefused(true);
                return;
              }
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
  const { searchStock } = useEditorServices().tools;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StockHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

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
          setProblem({
            text: isServiceError(error) ? error.message : 'Stock photos could not be loaded. Try again.',
            retry: !isServiceError(error) || retriable(error),
          });
        })
        .finally(() => setBusy(false));
    }, q.length === 0 ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [query, attempt]);

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
        <Problem text={problem.text} onRetry={problem.retry ? () => setAttempt((n) => n + 1) : undefined} />
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
  const service = useEditorServices().assets;
  const [assets, setAssets] = useState<MediaAssetSummary[] | 'loading' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  /** Tiles whose picture did not decode; they show the file name instead. */
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (spaceId === null) return;
    let current = true;
    setAssets('loading');
    service.list(spaceId, '').then(
      (list) => { if (current) setAssets(list); },
      () => { if (current) setAssets('failed'); },
    );
    return () => { current = false; };
  }, [service, spaceId, attempt]);
  if (spaceId === null) {
    return <p className="text-caption text-muted-foreground">No space open to read files from yet.</p>;
  }
  if (assets === 'loading') {
    return <p className="text-caption text-muted-foreground">Loading this space’s files…</p>;
  }
  if (assets === 'failed') {
    return <Problem text="This space’s files could not be loaded. Check the connection and try again." onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (assets.length === 0) {
    return <p className="text-caption text-muted-foreground">Nothing uploaded in this space yet.</p>;
  }
  return (
    <div className="grid grid-cols-4 gap-3">
      {assets.map((asset) => {
        const url = service.url(asset.id);
        const selected = selectedUrl === url;
        const picture = asset.kind === 'image' && !broken.has(asset.id);
        return (
          <button
            key={asset.id}
            type="button"
            aria-pressed={selected}
            title={asset.name}
            onClick={() => onPick(asset)}
            className={cn(
              'relative aspect-[4/3] overflow-hidden rounded-lg bg-muted',
              selected ? 'outline outline-2 -outline-offset-2 outline-primary' : 'hover:outline hover:outline-2 hover:outline-primary',
            )}
          >
            {picture ? (
              <img
                src={url}
                alt={asset.alt ?? asset.name}
                className="size-full object-cover"
                onError={() => setBroken((current) => new Set(current).add(asset.id))}
              />
            ) : (
              <span className="grid size-full content-center gap-0.5 p-2 text-center">
                <span className="text-caption font-semibold text-muted-foreground">{ASSET_KIND_WORDS[asset.kind]}</span>
                <span className="line-clamp-2 break-all text-caption text-muted-foreground">{asset.name}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** What a space file tile says it is when it shows no picture. */
const ASSET_KIND_WORDS: Record<MediaAssetSummary['kind'], string> = {
  image: 'Picture',
  video: 'Video',
  audio: 'Recording',
  pdf: 'PDF',
};

function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="alert">
      <p className="text-caption text-destructive">{text}</p>
      {onRetry === undefined ? null : (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const NO_PLACE_FOR_PICTURE =
  'This slide has no place for the picture. Cancel, select a picture frame or a picture slide, and try again.';

const NOT_A_PICTURE = 'This file is not a picture that can be shown. Choose a PNG, JPEG, GIF, WebP or AVIF file.';

/**
 * Upload one picture into the space. Insert waits until the uploaded file has
 * loaded as a picture, so a file that only claims to be an image never reaches
 * the slide.
 */
function UploadPane({
  spaceId,
  onPick,
}: {
  spaceId: string | null;
  onPick: (media: OutlineMedia | null) => void;
}) {
  const { assets } = useEditorServices();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const lastFile = useRef<File | null>(null);
  const [problem, setProblem] = useState<{ text: string; retry: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploaded, setUploaded] = useState<{ media: OutlineMedia; name: string; shown: boolean } | null>(null);
  const upload = async (file: File | undefined) => {
    if (file === undefined) return;
    if (spaceId === null) {
      setProblem({ text: 'No space to upload into.', retry: false });
      return;
    }
    if (file.type !== '' && !file.type.startsWith('image/')) {
      setProblem({ text: NOT_A_PICTURE, retry: false });
      return;
    }
    lastFile.current = file;
    setBusy(true);
    setProblem(null);
    setUploaded(null);
    onPick(null);
    try {
      const asset = await assets.upload(spaceId, file);
      if (asset.kind !== 'image') {
        setProblem({ text: NOT_A_PICTURE, retry: false });
        return;
      }
      setUploaded({
        media: { type: 'image', assetId: asset.id, url: assets.url(asset.id), alt: asset.alt ?? '' },
        name: file.name,
        shown: false,
      });
    } catch (error) {
      setProblem({
        text: isServiceError(error) ? error.message : 'The upload did not finish. Try again.',
        retry: !isServiceError(error) || retriable(error),
      });
    } finally {
      setBusy(false);
    }
  };
  const choose = () => fileInput.current?.click();
  return (
    <div className="flex flex-col gap-3">
      {uploaded === null ? (
        <button
          type="button"
          onClick={choose}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files[0]);
          }}
          className={cn(
            'rounded-lg border border-dashed border-input px-4 py-8 text-secondary text-muted-foreground hover:bg-background',
            dragging && 'border-primary bg-background',
          )}
        >
          {busy ? 'Uploading…' : 'Drop a picture here or click to choose one. Max 20 MB.'}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3" data-upload-picked>
          <img
            src={uploaded.media.url}
            alt=""
            className="size-16 shrink-0 rounded-md bg-muted object-cover"
            onLoad={() => {
              setUploaded((current) => (current === null ? null : { ...current, shown: true }));
              onPick(uploaded.media);
            }}
            onError={() => {
              setUploaded(null);
              onPick(null);
              setProblem({ text: NOT_A_PICTURE, retry: false });
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-secondary">{uploaded.name}</span>
            <span className="text-caption text-muted-foreground">
              {uploaded.shown ? 'Uploaded to this space.' : 'Checking the picture…'}
            </span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={choose}>
            Replace
          </Button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Picture file"
        onChange={(event) => {
          void upload(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      {problem === null ? null : (
        <Problem
          text={problem.text}
          onRetry={problem.retry && lastFile.current !== null ? () => void upload(lastFile.current ?? undefined) : undefined}
        />
      )}
    </div>
  );
}

/** Why an address cannot be used as a picture, or null when it can. */
export function pictureAddressProblem(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'Enter a full address that starts with https://.';
  }
  if (url.protocol !== 'https:') return 'Enter an address that starts with https://.';
  if (text.length > 2000) return 'This address is too long.';
  return null;
}

/**
 * A picture from an address. The address is previewed before Insert, so a
 * page or a broken link never reaches the slide. The alt text starts empty;
 * the picture pane asks for it.
 */
function LinkPane({ onPick }: { onPick: (media: OutlineMedia | null) => void }) {
  const [value, setValue] = useState('');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'shown' | 'broken'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const use = () => {
    const url = value.trim();
    if (url === '') return;
    const refusal = pictureAddressProblem(url);
    onPick(null);
    if (refusal !== null) {
      setCandidate(null);
      setProblem(refusal);
      return;
    }
    setProblem(null);
    setState('loading');
    setCandidate(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          use();
        }}
      >
        <Input
          value={value}
          placeholder="https://…"
          aria-label="Picture address"
          inputMode="url"
          onChange={(event) => setValue(event.currentTarget.value)}
        />
        <Button type="submit">Use</Button>
      </form>
      {problem === null ? null : <Problem text={problem} />}
      {candidate === null ? null : (
        <div className="flex items-center gap-3" data-link-preview={state}>
          <img
            key={candidate}
            src={candidate}
            alt=""
            referrerPolicy="no-referrer"
            className={cn('size-24 shrink-0 rounded-md bg-muted object-cover', state === 'broken' && 'hidden')}
            onLoad={() => {
              setState('shown');
              onPick({ type: 'image', url: candidate, alt: '' });
            }}
            onError={() => {
              setState('broken');
              onPick(null);
            }}
          />
          {state === 'loading' ? (
            <p className="text-caption text-muted-foreground">Loading the picture…</p>
          ) : state === 'broken' ? (
            <Problem text="This address does not return a picture. Check it and try again." />
          ) : (
            <p className="text-caption text-muted-foreground">Insert puts this picture on the slide.</p>
          )}
        </div>
      )}
    </div>
  );
}
