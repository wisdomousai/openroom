import { useEffect, useState } from 'react';

import { contextFromFields, fieldsFromContext, type ContextFields } from '../lib/context-fields';
import { givenName, possessive } from '../lib/initials';
import { ContextFieldsEditor } from './ContextFieldsEditor';
import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  context: Record<string, unknown>;
  busy?: boolean;
  onSave: (context: Record<string, unknown>) => void | Promise<void>;
}

/**
 * Context fields editor. All fields optional.
 * Used as the edit dialog on a person's folder.
 */
export function ContextDialog({
  open,
  onOpenChange,
  displayName,
  context,
  busy = false,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<ContextFields>(() => fieldsFromContext(context));

  useEffect(() => {
    if (open) setDraft(fieldsFromContext(context));
  }, [open, context]);

  const who = givenName(displayName);

  const submit = async () => {
    await onSave(contextFromFields(draft));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-3rem)] w-[min(620px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-0 pt-[18px] pr-12">
          <DialogTitle>{possessive(who)} context</DialogTitle>
        </DialogHeader>

        <DialogBody className="px-6 pb-5 pt-4">
          <ContextFieldsEditor value={draft} onChange={setDraft} />
        </DialogBody>

        <DialogFooter className="-mx-0 -mb-0 px-6">
          <p className="min-w-0 text-caption text-muted-foreground">All fields optional.</p>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
