import { Button } from '@openroom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';

/**
 * A recoverable live session of this deck (and its student). Start session
 * stays: a deck can be started more than once. The cue sits beside it, and
 * Start asks once whether to rejoin.
 */
export interface LiveNowCue {
  /** The rejoin button text: `Rejoin`, or `Join` for a session shared with you. */
  label: string;
  /** The student the session belongs to, when it has one. */
  who?: string | null;
  onRejoin: () => void;
  rejoining: boolean;
}

/** `Live now` and the way back in, beside Start session. */
export function LiveNowButton({ live }: { live: LiveNowCue }) {
  return (
    <span className="flex shrink-0 items-center gap-2" data-deck-live-now>
      <span className="text-caption text-muted-foreground">Live now</span>
      <Button size="sm" variant="outline" disabled={live.rejoining} onClick={live.onRejoin}>
        {live.rejoining ? 'Joining…' : live.label}
      </Button>
    </span>
  );
}

/** The one question Start asks while a session of this deck is running. */
export function LiveStartDialog({ live, open, onOpenChange, onStartAnother }: {
  live: LiveNowCue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartAnother: () => void;
}) {
  const running = live?.who
    ? `A session of this deck with ${live.who} is still running.`
    : 'A session of this deck is still running.';
  return (
    <Dialog open={open && live !== null} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="deck-live-confirm">
        <DialogHeader>
          <DialogTitle>This deck is live now</DialogTitle>
          <DialogDescription id="deck-live-confirm">
            {running} Rejoin it, or start another session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="outline" onClick={() => { onOpenChange(false); onStartAnother(); }}>
            Start another
          </Button>
          <Button
            type="button"
            disabled={live?.rejoining ?? true}
            onClick={() => { onOpenChange(false); live?.onRejoin(); }}
          >
            Rejoin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
