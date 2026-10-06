import { useEffect, useState } from 'react';
import { iframeUrlIssue } from '@openroom/schema';

import { checkEmbeddable, type EmbedCheck } from '../../api';
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

/** What a refusal is called, in the teacher's words. */
export function embedRefusalText(reason: Exclude<EmbedCheck, { embeddable: true }>['reason']): string {
  if (reason === 'unreachable') return 'This page could not be reached.';
  return 'This page does not allow embedding.';
}

export function IframeElementDialog({
  open,
  deckId,
  initialUrl,
  initialTitle,
  onOpenChange,
  onSave,
  onImportAsReading,
}: {
  open: boolean;
  /** Absent on an unsaved local file, where the probe has no scope to run in. */
  deckId?: string | null;
  initialUrl?: string;
  initialTitle?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (url: string, title: string) => void;
  /** Hand this address to the reading-material dialog instead. */
  onImportAsReading?: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [title, setTitle] = useState(initialTitle ?? '');
  const [check, setCheck] = useState<EmbedCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl ?? '');
    setTitle(initialTitle ?? '');
    setCheck(null);
    setChecking(false);
  }, [initialTitle, initialUrl, open]);

  const urlIssue = url === '' ? null : iframeUrlIssue(url);
  const valid = url !== '' && title.trim() !== '' && urlIssue === null;

  /*
   * The probe is debounced and advisory. A blocked frame fires `load`, not
   * `error`, so the browser cannot tell us this — but the answer can also be
   * wrong (some publishers vary the header by path or client), which is why a
   * refusal never disables Insert.
   */
  useEffect(() => {
    if (!open || urlIssue !== null || url === '' || deckId === null || deckId === undefined) {
      setCheck(null);
      return;
    }
    let cancelled = false;
    setCheck(null);
    const timer = setTimeout(() => {
      setChecking(true);
      checkEmbeddable({ url, deckId })
        .then((result) => {
          if (!cancelled) setCheck(result);
        })
        .catch(() => {
          // A probe that cannot run is not a verdict. Say nothing.
          if (!cancelled) setCheck(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deckId, open, url, urlIssue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))] max-w-none gap-0 p-0">
        <DialogHeader className="px-6 pb-2 pt-5">
          <DialogTitle>{initialUrl ? 'Edit web page' : 'Insert web page'}</DialogTitle>
          <DialogDescription>
            Add an embeddable HTTPS page as a full slide. The page runs in a restricted iframe.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-3">
          <label className="flex flex-col gap-1.5 text-secondary">
            Web address
            <Input
              aria-label="Web address"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder="https://example.org/embed"
            />
          </label>
          {urlIssue === null ? null : <p className="text-caption text-destructive">{urlIssue}</p>}
          <label className="flex flex-col gap-1.5 text-secondary">
            Accessible title
            <Input
              aria-label="Accessible title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="News article"
            />
          </label>
          {checking ? <p className="text-caption text-muted-foreground">Checking the page…</p> : null}
          {check !== null && !check.embeddable ? (
            <div className="flex flex-col items-start gap-2" role="status">
              <p className="text-caption text-destructive">{embedRefusalText(check.reason)}</p>
              {onImportAsReading === undefined ? null : (
                <Button type="button" size="sm" variant="outline" onClick={() => onImportAsReading(url)}>
                  Import as reading material
                </Button>
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter className="border-t border-hairline bg-background px-6 py-3">
          <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              onSave(url, title.trim());
              onOpenChange(false);
            }}
          >
            {initialUrl ? 'Save' : 'Insert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
