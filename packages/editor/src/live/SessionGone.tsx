/**
 * A host surface whose session or access is over: the console, the phone
 * remote and the Q&A desk. The server refused this device's host credential for
 * good, so nothing here can send a command; the panel says why and offers the
 * way out. Offline stays the network state with its own label.
 */
import { Alert, AlertDescription, AlertTitle } from '@openroom/ui/components/alert';
import { Button } from '@openroom/ui/components/button';

/** Why the host credential was refused, from the HTTP status of the refused reads. */
export type HostGone = 'removed' | 'expired' | 'ended';

export function hostGoneFromStatus(httpStatus: number): HostGone {
  if (httpStatus === 403) return 'removed';
  if (httpStatus === 401) return 'expired';
  return 'ended';
}

const TITLE: Record<HostGone, string> = {
  removed: 'Your access to this session was removed.',
  expired: "This device's access to the session expired.",
  ended: 'This session has ended.',
};

const NEXT: Record<HostGone, string | null> = {
  removed: null,
  expired: 'Rejoin it under Live now in the Library if it is still running.',
  ended: null,
};

export function SessionGone({
  gone,
  notes,
  leaveLabel,
  onLeave,
  compact = false,
}: {
  gone: HostGone;
  /** This device's private notes for the session, shown so they can be copied. */
  notes?: string;
  leaveLabel: string;
  onLeave: () => void;
  /** The phone remote's narrow column. */
  compact?: boolean;
}) {
  const next = NEXT[gone];
  const kept = notes?.trim() ?? '';
  return (
    <div
      className={
        compact
          ? 'mx-auto flex min-h-dvh w-full max-w-[402px] flex-col justify-center gap-4 px-5'
          : 'mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 p-6'
      }
    >
      <Alert role="alert">
        <AlertTitle>{TITLE[gone]}</AlertTitle>
        {next !== null ? <AlertDescription className="mt-1">{next}</AlertDescription> : null}
      </Alert>
      {kept !== '' ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Your private notes</h2>
          <p className="text-secondary text-muted-foreground">They stay on this device. Copy them if you need them.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm select-text">
            {kept}
          </pre>
        </section>
      ) : null}
      <div>
        <Button className={compact ? 'h-12 w-full rounded-xl text-option' : undefined} onClick={onLeave}>
          {leaveLabel}
        </Button>
      </div>
    </div>
  );
}
