import { describe, expect, it } from 'vitest';
import {
  canOpenQuestionOnStage,
  focusInteractionId,
  nextRailSelection,
} from './useQuestionRail';
import type { HostSnapshot } from './types';
import type { RailItem } from './snapshot';

const items: RailItem[] = [
  { id: 'q1', type: 'choice', prompt: 'First', status: 'revealed', answered: 3 },
  { id: 'q2', type: 'choice', prompt: 'Second', status: 'open', answered: 1 },
];

describe('useQuestionRail helpers', () => {
  it('canOpenQuestionOnStage when live and id exists', () => {
    const snapshot = { status: 'live', revision: 1, frozen: false } as HostSnapshot;
    expect(canOpenQuestionOnStage('q1', snapshot, items, false)).toBe(true);
  });

  it('canOpenQuestionOnStage is false when ended or not live', () => {
    const live = { status: 'live', revision: 1, frozen: false } as HostSnapshot;
    const lobby = { status: 'lobby', revision: 1, frozen: false } as HostSnapshot;
    expect(canOpenQuestionOnStage('q1', live, items, true)).toBe(false);
    expect(canOpenQuestionOnStage('q1', lobby, items, false)).toBe(false);
    expect(canOpenQuestionOnStage('missing', live, items, false)).toBe(false);
  });

  it('nextRailSelection follows activeId when the stage moves', () => {
    expect(
      nextRailSelection({
        current: 'q1',
        activeId: 'q2',
        prevActiveId: 'q1',
        items,
      }),
    ).toBe('q2');
  });

  it('nextRailSelection keeps a pending rail tap when only items refresh', () => {
    expect(
      nextRailSelection({
        current: 'q2',
        activeId: 'q1',
        prevActiveId: 'q1',
        items,
      }),
    ).toBe('q2');
  });

  it('nextRailSelection seeds from activeId when selection is empty', () => {
    expect(
      nextRailSelection({
        current: null,
        activeId: 'q1',
        prevActiveId: 'q1',
        items,
      }),
    ).toBe('q1');
  });

  it('nextRailSelection follows on first pass when prevActiveId is undefined', () => {
    expect(
      nextRailSelection({
        current: null,
        activeId: 'q2',
        prevActiveId: undefined,
        items,
      }),
    ).toBe('q2');
  });

  it('focusInteractionId prefers rail selection so taps and stage-follow stay aligned', () => {
    expect(focusInteractionId('q2', 'q1')).toBe('q2');
    expect(focusInteractionId(null, 'q1')).toBe('q1');
    expect(focusInteractionId(null, null)).toBeNull();
  });
});
