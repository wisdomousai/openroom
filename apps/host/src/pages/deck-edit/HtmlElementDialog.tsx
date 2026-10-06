import { useEffect, useState } from 'react';
import { elementMarkupIssue } from '@openroom/schema';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';

/**
 * Markup + optional CSS for one HTML/SVG object. A dialog because a code box
 * does not belong in the pane.
 */
export function HtmlElementDialog({
  open,
  initialHtml,
  initialCss,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialHtml?: string;
  initialCss?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (html: string, css?: string) => void;
}) {
  const [html, setHtml] = useState(initialHtml ?? '');
  const [css, setCss] = useState(initialCss ?? '');

  useEffect(() => {
    if (!open) return;
    setHtml(initialHtml ?? '');
    setCss(initialCss ?? '');
  }, [initialCss, initialHtml, open]);

  /*
   * The same check the outline will apply. Without it an unsafe fragment is
   * dropped by `keepValid` and the dialog closes as though it worked, which
   * looks exactly like the object being inserted somewhere off-screen.
   */
  const issue = html.trim() === '' ? null : elementMarkupIssue(html, css.trim() === '' ? undefined : css);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,calc(100svh-5rem))] w-[min(40rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-2 pt-5">
          <DialogTitle>{initialHtml ? 'Edit HTML' : 'Insert HTML'}</DialogTitle>
          <DialogDescription>
            A fragment — HTML or SVG — that sits in a box on this slide. No script.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-3">
          <Textarea
            aria-label="HTML or SVG"
            rows={10}
            className="font-mono text-caption"
            value={html}
            onChange={(event) => setHtml(event.currentTarget.value)}
            placeholder={'<svg viewBox="0 0 100 60" aria-label="A sketch">\n  <rect x="4" y="20" width="92" height="8"/>\n</svg>'}
          />
          <Textarea
            aria-label="CSS for this box"
            rows={4}
            className="font-mono text-caption"
            value={css}
            onChange={(event) => setCss(event.currentTarget.value)}
            placeholder="Optional CSS, scoped to this box."
          />
          {issue === null ? null : <p className="text-caption text-destructive" role="alert">{issue}</p>}
        </div>
        <DialogFooter className="border-t border-hairline bg-background px-6 py-3">
          <p className="text-caption text-muted-foreground">Saving in this school’s colours when a DESIGN.md is present.</p>
          <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={html.trim() === '' || issue !== null}
            onClick={() => {
              onSave(html, css.trim() === '' ? undefined : css);
              onOpenChange(false);
            }}
          >
            {initialHtml ? 'Save' : 'Insert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
