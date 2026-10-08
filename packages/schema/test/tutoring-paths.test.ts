import { describe, expect, it } from 'vitest';

import { isTutoringApiPath } from '../src/tutoring-paths.js';

describe('isTutoringApiPath', () => {
  it('accepts contexts, decks, and sessions paths', () => {
    expect(isTutoringApiPath('/api/tutoring/contexts')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/restore')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/learners')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/returned')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/work')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/work/w1')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/work/w1/feedback')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/links')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/contexts/c1/links/l1')).toBe(true);
    expect(isTutoringApiPath('/api/presentations/start')).toBe(true);
    expect(isTutoringApiPath('/api/presentations/start/other')).toBe(false);
    expect(isTutoringApiPath('/api/decks')).toBe(true);
    expect(isTutoringApiPath('/api/decks/d1')).toBe(true);
    expect(isTutoringApiPath('/api/decks/d1/versions')).toBe(true);
    expect(isTutoringApiPath('/api/sessions')).toBe(true);
    expect(isTutoringApiPath('/api/sessions/s1/launch')).toBe(true);
    expect(isTutoringApiPath('/api/sessions/s1/record')).toBe(true);
    expect(isTutoringApiPath('/api/sessions?trash=1')).toBe(true);
  });

  it('keeps account billing off the peer-client surface', () => {
    for (const path of ['/api/my/billing', '/api/my/billing/plans', '/api/my/billing/checkout', '/api/my/billing/portal', '/api/my/billing/sync']) expect(isTutoringApiPath(path)).toBe(false);
  });

  it('accepts the media asset plane', () => {
    expect(isTutoringApiPath('/api/tutoring/spaces/s1/assets')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/spaces/s1/assets?query=gare')).toBe(true);
    expect(isTutoringApiPath('/api/tutoring/assets/a1')).toBe(true);
  });

  it('allows account archive reads without admitting nested or arbitrary account resources', () => {
    for (const path of ['/api/my/archives', '/api/my/archives/ABCDEFGH?format=ballots', '/api/my/archives/ABCDEFGH/document']) expect(isTutoringApiPath(path)).toBe(true);
    for (const path of ['/api/my/archives/a/edit', '/api/my/users']) expect(isTutoringApiPath(path)).toBe(false);
  });

  it('limits sharing to spaces, named membership operations and account invitations', () => {
    for (const path of ['/api/my/spaces', '/api/my/spaces/s/members', '/api/my/spaces/s/members/u', '/api/my/spaces/s/invites', '/api/my/invites', '/api/my/invites/i', '/api/my/invites/i/accept']) expect(isTutoringApiPath(path)).toBe(true);
    for (const path of ['/api/my/spaces/s/members/u/anything', '/api/my/invites/i/accept/anything', '/api/my/users', '/api/my/tokens']) expect(isTutoringApiPath(path)).toBe(false);
  });

  it('rejects unknown and retired paths', () => {
    expect(isTutoringApiPath('/api/tutoring/spaces/s1')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/nope')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/learners')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/designs')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/runs')).toBe(false);
    expect(isTutoringApiPath('/api/rooms')).toBe(false);
    // Live-control leaves stay off the generic surface.
    expect(isTutoringApiPath('/api/sessions/s1/commands')).toBe(false);
    expect(isTutoringApiPath('/api/sessions/s1/export')).toBe(false);
  });
});

describe('console conveniences stay off the agent surface', () => {
  it('does not admit the lookup routes', () => {
    // These are deliberately absent from the allowlist. The assertion exists so
    // that widening the pattern has to be a decision rather than an accident.
    expect(isTutoringApiPath('/api/tutoring/dictionary')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/lookup')).toBe(false);
    expect(isTutoringApiPath('/api/tutoring/stock')).toBe(false);
  });
});
