/**
 * Beside the live participant count once the session admits no one new. The
 * limit is fixed when the session starts, from the space owner's billing
 * (`largeSessions`); admitted participants can still re-enter. Plans is offered
 * to the space's owner and editors only — presenters see the fact alone.
 */
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { to } from '../../../../apps/host/src/destinations';
import { Button } from '@openroom/ui/components/button';

/** True once a limited session holds as many participants as it admits. */
export function sessionFull(joined: number, limit: number | undefined): boolean {
  return limit !== undefined && joined >= limit;
}

export function SessionFullNotice({
  joined,
  limit,
  canManagePlan,
}: {
  joined: number;
  limit: number | undefined;
  canManagePlan: boolean;
}) {
  if (!sessionFull(joined, limit)) return null;
  return (
    <span data-or-lock="large-sessions" role="status" className="inline-flex items-center gap-2 text-sm">
      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold">Session full</span>
      {canManagePlan ? (
        <Button asChild variant="outline" size="sm">
          <Link {...to.billing()}>Plans</Link>
        </Button>
      ) : null}
    </span>
  );
}
