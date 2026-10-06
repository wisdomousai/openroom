import { useEffect, useMemo, useState } from 'react';
import { elementMarkupIssue, iframeUrlIssue, renderMarkdownToHtml } from '@openroom/schema';
import { HtmlHost } from '@openroom/slides';

import { ApiError, importReadingMaterial } from '../../../../apps/host/src/api';
import { desktopBridge } from '../../../../apps/host/src/desktop-bridge';
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
import { Textarea } from '@openroom/ui/components/textarea';

/**
 * Reading material: a slide of prose the learner scrolls.
 *
 * Markdown is the source the teacher edits. The html that ends up in the file
 * is rendered from it here, by the same function the validator checks against,
 * so the preview below is literally what the slide will draw.
 *
 * The import path exists because a page that refuses framing can still be read.
 * Nothing reaches the outline until Insert: an import fills this textarea and
 * waits, so the teacher sees what they are about to put in front of a class.
 */
/** The route answers in codes; the dialog says what happened. */
function importProblemText(cause: unknown): string {
  const code = cause instanceof ApiError ? cause.code : undefined;
  if (code === 'page-not-html') return 'That address is not a web page.';
  if (code === 'page-empty') return 'That page had no readable text.';
  if (code === 'page-unreachable') return 'That page could not be reached.';
  if (code === 'invalid-url') return 'That address cannot be read.';
  if (code === 'embed-rate-limited') return 'Too many pages read just now. Try again in a minute.';
  return 'That page could not be read.';
}

export function MarkdownElementDialog({
  open,
  deckId,
  initialMarkdown,
  initialUrl,
  onOpenChange,
  onSave,
  onRefineWithAgent,
}: {
  open: boolean;
  /** Absent on an unsaved local file, where there is nothing to import against. */
  deckId?: string | null;
  initialMarkdown?: string;
  /** Prefilled when the teacher arrives here from a web page that refused framing. */
  initialUrl?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (markdown: string) => void;
  onRefineWithAgent?: (markdown: string) => void;
}) {
  const bridge = desktopBridge();
  const [markdown, setMarkdown] = useState(initialMarkdown ?? '');
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMarkdown(initialMarkdown ?? '');
    setUrl(initialUrl ?? '');
    setBusy(false);
    setProblem(null);
  }, [initialMarkdown, initialUrl, open]);

  const html = useMemo(() => renderMarkdownToHtml(markdown), [markdown]);
  // The same check the file will face, surfaced here rather than swallowed by a
  // silent no-op the way the plain HTML dialog's used to be.
  const issue = markdown.trim() === '' ? null : elementMarkupIssue(html, undefined, markdown);
  const urlIssue = url === '' ? null : iframeUrlIssue(url);
  const valid = markdown.trim() !== '' && issue === null;
  const canImport = deckId !== null && deckId !== undefined && url !== '' && urlIssue === null && !busy;

  const runImport = async () => {
    if (deckId === null || deckId === undefined) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await importReadingMaterial({ url, deckId });
      setMarkdown(result.markdown);
    } catch (cause) {
      setProblem(importProblemText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(52rem,calc(100vw-2rem))] max-w-none gap-0 p-0">
        <DialogHeader className="px-6 pb-2 pt-5">
          <DialogTitle>{initialMarkdown === undefined ? 'Insert reading' : 'Edit reading'}</DialogTitle>
          <DialogDescription>
            A slide of reading material the class scrolls. Write it, or read it off a web page.
          </DialogDescription>
        </DialogHeader>

        {deckId === null || deckId === undefined ? null : (
          <div className="flex items-end gap-2 px-6 py-2">
            <label className="flex flex-1 flex-col gap-1.5 text-secondary">
              Web address
              <Input
                aria-label="Web address"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                placeholder="https://example.org/article"
              />
            </label>
            <Button type="button" variant="outline" disabled={!canImport} onClick={() => void runImport()}>
              {busy ? 'Reading…' : 'Read the page'}
            </Button>
          </div>
        )}
        {urlIssue === null ? null : <p className="px-6 text-caption text-destructive">{urlIssue}</p>}

        <div className="grid grid-cols-2 gap-4 px-6 py-3">
          <label className="flex flex-col gap-1.5 text-secondary">
            Markdown
            <Textarea
              aria-label="Markdown"
              className="h-72 font-mono text-caption"
              value={markdown}
              onChange={(event) => setMarkdown(event.currentTarget.value)}
              placeholder={'# Heading\n\nA paragraph.\n\n- a point\n- another'}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-secondary">
            Preview
            {/*
              The preview is the slide's own renderer, not a lookalike: same
              sanitiser, same shadow root, same reading typography. So what the
              teacher approves here is what the class will see.
            */}
            <div
              aria-label="Preview"
              className="h-72 overflow-hidden rounded-md border border-hairline bg-background"
            >
              <HtmlHost html={html} scroll />
            </div>
          </div>
        </div>

        {issue === null ? null : (
          <p className="px-6 text-caption text-destructive" role="alert">
            {issue}
          </p>
        )}
        {problem === null ? null : (
          <p className="px-6 text-caption text-destructive" role="alert">
            {problem}
          </p>
        )}

        <DialogFooter className="border-t border-hairline bg-background px-6 py-3">
          {bridge === null || onRefineWithAgent === undefined ? null : (
            <Button
              type="button"
              variant="subtle"
              className="mr-auto"
              disabled={!valid}
              onClick={() => {
                onRefineWithAgent(markdown);
                onOpenChange(false);
              }}
            >
              Refine with the agent
            </Button>
          )}
          <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid || busy}
            onClick={() => {
              onSave(markdown);
              onOpenChange(false);
            }}
          >
            {initialMarkdown === undefined ? 'Insert' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
