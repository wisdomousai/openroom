/**
 * The continuity lock: shown (never hidden) wherever the worker answers
 * `403 continuity-required`, always with the way to Settings → Billing.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';

import { ApiError } from '../api/client';
import { LoadState } from '../pages/tutor/shared';
import { ContinuityLock, isContinuityRequired, sessionStartMessage } from './ContinuityLock';

const rootRoute = createRootRoute();
const router = createRouter({
  routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/settings/billing' })]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterContextProvider router={router as never}>{node}</RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe('continuity lock', () => {
  it('names the capability and links to billing plans', () => {
    const html = render(<ContinuityLock />);
    expect(html).toContain('data-or-lock="continuity"');
    expect(html).toContain('>Homework and Notes<');
    expect(html).toContain('href="/settings/billing"');
    expect(html).toContain('>Plans<');
  });

  it('replaces the load error on a continuity-required page', () => {
    const locked = render(<LoadState error="continuity-required" />);
    expect(locked).toContain('data-or-lock="continuity"');
    expect(locked).not.toContain('role="alert"');
    const failed = render(<LoadState error="Could not load the context" />);
    expect(failed).not.toContain('data-or-lock');
    expect(failed).toContain('Could not load the context');
  });

  it('recognises only the continuity-required code', () => {
    expect(isContinuityRequired(new ApiError(403, 'continuity-required'))).toBe(true);
    expect(isContinuityRequired(new ApiError(403, 'forbidden'))).toBe(false);
    expect(isContinuityRequired(new Error('continuity-required'))).toBe(false);
    expect(sessionStartMessage(new ApiError(403, 'continuity-required'), 'x')).toBe('Identified sessions are part of a paid plan.');
    expect(sessionStartMessage(new ApiError(403, 'roster-required'), 'x')).toBe('roster-required');
  });
});
