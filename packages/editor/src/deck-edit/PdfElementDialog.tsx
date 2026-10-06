import { useEffect, useState } from 'react';
import { pdfUrlIssue, type OpenRoomFileResourceV1, type OutlinePdfElement } from '@openroom/schema';

import { isServiceError, useEditorServices } from '../services';
import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { Input } from '@openroom/ui/components/input';

type PdfSource = Pick<OutlinePdfElement, 'url' | 'assetId' | 'resourceId'>;

export function PdfElementDialog({
  open,
  spaceId,
  initialUrl,
  initialResourceId,
  initialTitle,
  onOpenChange,
  onEmbedded,
  onSave,
}: {
  open: boolean;
  /** Set when the deck is synced to a space; its assets outlive this window. */
  spaceId?: string | null;
  initialUrl?: string;
  initialResourceId?: string;
  initialTitle?: string;
  onOpenChange: (open: boolean) => void;
  onEmbedded?: (resourceId: string, resource: OpenRoomFileResourceV1) => void;
  onSave: (source: PdfSource, title: string) => void;
}) {
  const { desktop: bridge, assets } = useEditorServices();
  const embeddedInitialUrl = initialUrl?.startsWith('https://local.openroom.invalid/') === true
    ? initialUrl
    : undefined;
  const [mode, setMode] = useState<'file' | 'link'>(bridge === null ? 'link' : 'file');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [title, setTitle] = useState(initialTitle ?? '');
  const [selection, setSelection] = useState<{ selectionId: string; name: string; pageCount: number } | null>(null);
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(bridge === null || (initialUrl !== undefined && embeddedInitialUrl === undefined) ? 'link' : 'file');
    setUrl(initialUrl ?? '');
    setTitle(initialTitle ?? '');
    setSelection(null);
    setFromPage(1);
    setToPage(1);
    setProblem(null);
  }, [bridge, embeddedInitialUrl, initialTitle, initialUrl, open]);

  const urlIssue = url === '' ? null : pdfUrlIssue(url);
  const linkValid = url !== '' && title.trim() !== '' && urlIssue === null;
  const rangeValid = selection !== null
    && Number.isInteger(fromPage)
    && Number.isInteger(toPage)
    && fromPage >= 1
    && toPage >= fromPage
    && toPage <= selection.pageCount
    && title.trim() !== '';
  const fileValid = rangeValid || (selection === null && embeddedInitialUrl !== undefined && title.trim() !== '');
  const editing = initialUrl !== undefined || initialResourceId !== undefined;

  const choosePdf = async () => {
    if (bridge === null) return;
    setProblem(null);
    try {
      const picked = await bridge.pickPdf();
      if (picked === null) return;
      setSelection(picked);
      setFromPage(1);
      setToPage(picked.pageCount);
      if (title.trim() === '') setTitle(picked.name.replace(/\.pdf$/i, ''));
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'The PDF could not be opened.');
    }
  };

  const insertLocal = async () => {
    if (selection === null && embeddedInitialUrl !== undefined && title.trim() !== '') {
      onSave({ url: embeddedInitialUrl }, title.trim());
      onOpenChange(false);
      return;
    }
    if (bridge === null || selection === null || !rangeValid) return;
    setBusy(true);
    setProblem(null);
    try {
      // A synced design has no .openroom package to embed into: the pages go to the space's
      // asset store, the same place pictures go, so they survive this window closing.
      if (spaceId !== null && spaceId !== undefined) {
        const extracted = await bridge.extractPdfBytes(selection.selectionId, fromPage, toPage);
        const asset = await assets.upload(
          spaceId,
          new File([new Uint8Array(extracted.bytes)], extracted.name, { type: 'application/pdf' }),
        );
        onSave({ assetId: asset.id, url: assets.url(asset.id) }, title.trim());
        onOpenChange(false);
        return;
      }
      const embedded = await bridge.extractPdf(selection.selectionId, fromPage, toPage);
      onEmbedded?.(embedded.resourceId, embedded.resource);
      onSave({ url: `https://local.openroom.invalid/${encodeURIComponent(embedded.resourceId)}` }, title.trim());
      onOpenChange(false);
    } catch (cause) {
      setProblem(
        isServiceError(cause)
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'The selected pages could not be extracted.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(36rem,calc(100vw-2rem))] max-w-none gap-0 p-0">
        <DialogHeader className="px-6 pb-2 pt-5">
          <DialogTitle>{editing ? 'Edit PDF' : 'Insert PDF'}</DialogTitle>
          <DialogDescription>
            Add a scrollable PDF slide. Desktop can keep only the pages you choose inside the deck.
          </DialogDescription>
        </DialogHeader>
        {bridge === null ? null : (
          <div className="flex gap-1 px-6 py-2">
            <Button type="button" size="sm" variant={mode === 'file' ? 'secondary' : 'ghost'} onClick={() => setMode('file')}>From this computer</Button>
            <Button type="button" size="sm" variant={mode === 'link' ? 'secondary' : 'ghost'} onClick={() => setMode('link')}>From a link</Button>
          </div>
        )}
        <div className="flex flex-col gap-3 px-6 py-3">
          {mode === 'file' && bridge !== null ? (
            <>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => void choosePdf()}>Choose PDF…</Button>
                <span className="truncate text-sm text-muted-foreground">
                  {selection?.name ?? (embeddedInitialUrl === undefined ? 'No PDF chosen' : 'Embedded PDF')}
                </span>
              </div>
              {selection === null ? null : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-secondary">
                    First page
                    <Input type="number" min={1} max={selection.pageCount} value={fromPage} onChange={(event) => setFromPage(event.currentTarget.valueAsNumber)} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-secondary">
                    Last page
                    <Input type="number" min={fromPage} max={selection.pageCount} value={toPage} onChange={(event) => setToPage(event.currentTarget.valueAsNumber)} />
                  </label>
                  <p className="col-span-2 text-caption text-muted-foreground">
                    {selection.pageCount} pages in the source. The page range is inclusive; the original PDF is discarded.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-secondary">
                PDF address
                <Input aria-label="PDF address" type="url" value={url} onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://example.org/handout.pdf" />
              </label>
              {urlIssue === null ? null : <p className="text-caption text-destructive">{urlIssue}</p>}
            </>
          )}
          <label className="flex flex-col gap-1.5 text-secondary">
            Accessible title
            <Input aria-label="Accessible title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="Handout" />
          </label>
          {problem === null ? null : <p className="text-caption text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter className="border-t border-hairline bg-background px-6 py-3">
          <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={busy || (mode === 'file' ? !fileValid : !linkValid)}
            onClick={() => {
              if (mode === 'file') { void insertLocal(); return; }
              onSave({ url }, title.trim());
              onOpenChange(false);
            }}
          >
            {busy ? 'Extracting…' : editing ? 'Save' : 'Insert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
