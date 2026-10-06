/**
 * The full-session notice: appears only once a limited session holds its
 * limit, and offers Plans only to people who manage the space.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';

import { SessionFullNotice } from './SessionFullNotice';

const rootRoute = createRootRoute();
const router = createRouter({
  routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/settings/billing' })]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

function render(node: ReactNode): string {
  return renderToStaticMarkup(<RouterContextProvider router={router as never}>{node}</RouterContextProvider>);
}

describe('session full notice', () => {
  it('stays hidden below the limit and for unlimited sessions', () => {
    expect(render(<SessionFullNotice joined={49} limit={50} canManagePlan />)).toBe('');
    expect(render(<SessionFullNotice joined={500} limit={undefined} canManagePlan />)).toBe('');
  });

  it('names the full session and links an editor to billing plans', () => {
    const html = render(<SessionFullNotice joined={50} limit={50} canManagePlan />);
    expect(html).toContain('data-or-lock="large-sessions"');
    expect(html).toContain('>Session full<');
    expect(html).toContain('href="/settings/billing"');
    expect(html).toContain('>Plans<');
  });

  it('shows a presenter the fact without the plans action', () => {
    const html = render(<SessionFullNotice joined={50} limit={50} canManagePlan={false} />);
    expect(html).toContain('>Session full<');
    expect(html).not.toContain('Plans');
  });
});
