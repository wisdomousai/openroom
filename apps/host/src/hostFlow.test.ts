import { describe, expect, it } from 'vitest';
import { deriveHostFlow } from './hostFlow';
import type { HostSnapshot } from './types';

function snap(partial: Partial<HostSnapshot> & { status: HostSnapshot['status'] }): HostSnapshot {
  return {
    revision: 1,
    frozen: false,
    ...partial,
  } as HostSnapshot;
}

describe('deriveHostFlow', () => {
  it('starts from lobby', () => {
    expect(deriveHostFlow(snap({ status: 'lobby' }), { pendingLeft: 2 })).toEqual({
      kind: 'start',
      label: 'Start session',
    });
  });

  it('shows results when active is open but audience cannot see them', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'open',
          interactions: [{ id: 'q1', type: 'choice', prompt: 'P', status: 'open', answered: 0 }],
        }),
        { pendingLeft: 1, audienceSeesResults: false },
      ),
    ).toEqual({ kind: 'reveal', label: 'Reveal the results' });
  });

  it('advances when results are already live', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'open',
          interactions: [
            { id: 'q1', type: 'choice', prompt: 'P', status: 'open', answered: 1 },
            { id: 'q2', type: 'choice', prompt: 'P2', status: 'pending', answered: 0 },
          ],
        }),
        { pendingLeft: 1, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'advance', label: 'Next slide' });
  });

  it('advances when pending remain after reveal', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'revealed',
          interactions: [
            { id: 'q1', type: 'choice', prompt: 'P', status: 'revealed', answered: 1 },
            { id: 'q2', type: 'choice', prompt: 'P2', status: 'pending', answered: 0 },
          ],
        }),
        { pendingLeft: 1, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'advance', label: 'Next slide' });
  });

  it('ends when nothing pending', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'revealed',
          interactions: [{ id: 'q1', type: 'choice', prompt: 'P', status: 'revealed', answered: 1 }],
        }),
        { pendingLeft: 0, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'end', label: 'End session' });
  });

  it('returns null when ended', () => {
    expect(deriveHostFlow(snap({ status: 'ended' }), { pendingLeft: 0 })).toBeNull();
  });

  it('outline decks: next step when not on the last step', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          outline: {
            outlineVersion: 1,
            currentStepIndex: 0,
            content: {
              version: 1,
              meta: { title: 'L' },
              steps: [
                { id: 'a', kind: 'title', title: 'A' },
                { id: 'b', kind: 'title', title: 'B' },
              ],
              interactions: [],
            },
          },
        }),
        { pendingLeft: 0, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'advance', label: 'Next slide' });
  });

  it('outline decks: closed answers still reveal the key', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'closed',
          interactions: [{ id: 'q1', type: 'text', prompt: 'P', status: 'closed', answered: 1 }],
          outline: {
            outlineVersion: 1,
            currentStepIndex: 1,
            content: {
              version: 1,
              meta: { title: 'L' },
              steps: [
                { id: 'a', kind: 'title', title: 'A' },
                { id: 'poll', kind: 'interaction', interactionId: 'q1' },
              ],
              interactions: [],
            },
          },
        }),
        { pendingLeft: 0, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'reveal', label: 'Reveal the results' });
  });

  it('outline decks: reveal still wins over next step', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          activeInteractionId: 'q1',
          interactionStatus: 'open',
          interactions: [{ id: 'q1', type: 'choice', prompt: 'P', status: 'open', answered: 0 }],
          outline: {
            outlineVersion: 1,
            currentStepIndex: 1,
            content: {
              version: 1,
              meta: { title: 'L' },
              steps: [
                { id: 'a', kind: 'title', title: 'A' },
                { id: 'poll', kind: 'interaction', interactionId: 'q1' },
                { id: 'c', kind: 'title', title: 'C' },
              ],
              interactions: [],
            },
          },
        }),
        { pendingLeft: 0, audienceSeesResults: false },
      ),
    ).toEqual({ kind: 'reveal', label: 'Reveal the results' });
  });

  it('outline decks: end on the last step', () => {
    expect(
      deriveHostFlow(
        snap({
          status: 'live',
          outline: {
            outlineVersion: 1,
            currentStepIndex: 1,
            content: {
              version: 1,
              meta: { title: 'L' },
              steps: [
                { id: 'a', kind: 'title', title: 'A' },
                { id: 'b', kind: 'title', title: 'B' },
              ],
              interactions: [],
            },
          },
        }),
        { pendingLeft: 0, audienceSeesResults: true },
      ),
    ).toEqual({ kind: 'end', label: 'End session' });
  });
});
