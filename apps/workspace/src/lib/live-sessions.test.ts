import { describe, expect, it } from 'vitest';

import type { MySession } from '../api/tokens';
import { liveSessionOf } from './live-sessions';

const session = (over: Partial<MySession>): MySession => ({
  code: 'ABCD2345', sessionCode: 'ABCD2345', title: 'Au café', deckId: 'deck-1', contextId: 'ctx-lea',
  createdAt: 1, ended: false, recoverable: true, ...over,
});

describe('liveSessionOf', () => {
  it('finds the running session of this deck and student only', () => {
    const lea = session({});
    expect(liveSessionOf([lea], { id: 'deck-1', contextId: 'ctx-lea' })).toBe(lea);
    expect(liveSessionOf([lea], { id: 'deck-1', contextId: 'ctx-noor' })).toBeNull();
    expect(liveSessionOf([lea], { id: 'deck-2', contextId: 'ctx-lea' })).toBeNull();
    expect(liveSessionOf([session({ ended: true }), session({ recoverable: false })], { id: 'deck-1', contextId: 'ctx-lea' })).toBeNull();
  });

  it('treats a missing and an empty context as no student', () => {
    const open = session({ contextId: null });
    expect(liveSessionOf([open], { id: 'deck-1', contextId: '' })).toBe(open);
    expect(liveSessionOf([open], { id: 'deck-1' })).toBe(open);
  });
});
