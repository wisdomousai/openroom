import { useEffect, useState, type ReactNode } from 'react';
import { Input } from '@openroom/ui/components/input';
import { ArrowLeft } from 'lucide-react';

import { useEditorServices, type EditorDestination } from '../services';
import { Button } from '@openroom/ui/components/button';
import type { DraftStatus } from './useDraftSave';

/**
 * The deck editor's 44px chrome title bar.
 *
 * Where am I, is the file safe, and how do I put it in front of a class.
 * Editing verbs live in the ribbon.
 */
export function DeckEditorTopBar({
  title,
  onRename,
  fileStatus,
  folderName,
  libraryTo,
  shareTo,
  status,
  onPresent,
  canPresent,
  onStart,
  starting,
  canStart,
  startIssue,
  error,
}: {
  title: string;
  onRename?: (title: string) => void;
  fileStatus?: ReactNode;
  /** Null while the deck sits at the root of its space. */
  folderName: string | null;
  libraryTo: EditorDestination;
  /** Space members, when the deck is filed in a space. */
  shareTo: EditorDestination | null;
  status: DraftStatus;
  onPresent: () => void;
  canPresent: boolean;
  onStart: () => void;
  starting: boolean;
  canStart: boolean;
  startIssue?: string | null;
  error: string | null;
}) {
  const { Link } = useEditorServices().navigation;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  useEffect(() => { if (!editing) setName(title); }, [title, editing]);
  const commitName = () => { setEditing(false); onRename?.(name.trim() || 'Untitled'); };
  const savedPill =
    status.state === 'saved'
      ? folderName
        ? `Saved to ${folderName}`
        : 'Saved'
      : status.label === ''
        ? null
        : status.label;

  return (
    <header className="flex shrink-0 flex-col bg-chrome">
      <div className="flex h-11 items-center gap-3 px-2 pr-3">
        <Link
          to={libraryTo}
          title="Back to the folder"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-secondary text-muted-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="sr-only">Back</span>
        </Link>
        <div className="flex min-w-0 items-baseline gap-2">
          {folderName === null ? null : (
            <>
              <span className="truncate text-caption text-muted-foreground">{folderName}</span>
              <span aria-hidden="true" className="text-caption text-muted-foreground">
                /
              </span>
            </>
          )}
          {editing ? <Input autoFocus aria-label="Deck title" maxLength={200} value={name}
            className="h-7 w-64" onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.currentTarget.value)} onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { setName(title); setEditing(false); }
            }} /> : <button type="button" disabled={!onRename} onClick={() => setEditing(true)}
              className="truncate text-title-bar leading-none" data-deck-title aria-label="Rename deck">{title}</button>}

        </div>
        {savedPill === null ? null : (
          <span
            className={
              status.state === 'error'
                ? 'inline-flex h-6 shrink-0 items-center rounded-full bg-background px-2.5 text-caption text-destructive'
                : 'inline-flex h-6 shrink-0 items-center rounded-full bg-background px-2.5 text-caption text-muted-foreground'
            }
            data-or-draft-status={status.state}
            role="status"
          >
            {savedPill}
          </span>
        )}
        {fileStatus}
        <span className="flex-1" />
        {shareTo === null ? null : (
          <Button asChild variant="subtle" size="sm">
            <Link to={shareTo}>Share</Link>
          </Button>
        )}
        <Button
          data-deck-present
          disabled={!canPresent}
          onClick={onPresent}
          size="sm"
          variant="secondary"
        >
          Present
        </Button>
        <Button disabled={starting || !canStart || !!startIssue} onClick={onStart} size="sm" variant="live" aria-describedby={startIssue ? 'question-readiness' : undefined}>
          {starting ? 'Starting…' : 'Start session'}
        </Button>
      </div>
      {startIssue ? <p id="question-readiness" role="status" className="border-t border-border px-3 py-1.5 text-caption text-muted-foreground">{startIssue}</p> : null}
      {error === null ? null : (
        <p className="border-t border-border px-3 py-1.5 text-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
