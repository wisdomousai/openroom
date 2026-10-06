/**
 * Locked state for the paid `continuity` capability: the teaching loop of
 * Notes, homework, learner links, learner work and identified sessions.
 * Contexts themselves are free and never show it. Shown in place of the gated
 * surface — never hidden — with the way to Settings → Billing. Billing follows
 * the space owner, so surfaces react to the worker's 403 rather than to the
 * viewer's own entitlements.
 */
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { ApiError } from '../api/client';
import { to } from '../destinations';
import { Button } from './ui/button';

/** The worker's 403 code for a space owner without `continuity`. */
export const CONTINUITY_REQUIRED = 'continuity-required';

export function isContinuityRequired(error: unknown): boolean {
  return error instanceof ApiError && error.message === CONTINUITY_REQUIRED;
}

/** Start/launch failures: a readable line for the identified-session 403. */
export function sessionStartMessage(cause: unknown, fallback: string): string {
  if (isContinuityRequired(cause)) return 'Identified sessions are part of a paid plan.';
  return cause instanceof Error ? cause.message : fallback;
}

export function ContinuityLock({ className }: { className?: string }) {
  return (
    <section
      aria-label="Homework and Notes"
      data-or-lock="continuity"
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 ${className ?? ''}`}
    >
      <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-row-title">Homework and Notes</p>
        <p className="text-secondary text-muted-foreground">
          Notes, homework, learner links and identified sessions are part of a paid plan.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link {...to.billing()}>Plans</Link>
      </Button>
    </section>
  );
}
