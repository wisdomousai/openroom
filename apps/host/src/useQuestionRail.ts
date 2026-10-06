import { useCallback, useMemo, useState } from 'react';
import type { HostSnapshot } from './types';
import type { RailItem } from './snapshot';

export function canOpenQuestionOnStage(
  id: string | null,
  snapshot: HostSnapshot | null,
  items: RailItem[],
  ended: boolean,
): boolean {
  if (!id || ended || snapshot?.status !== 'live') return false;
  return items.some((i) => i.id === id);
}

/** UI focus: rail selection first; fall back to stage / empty. */
export function focusInteractionId(
  selectedId: string | null,
  activeId: string | null,
): string | null {
  return selectedId ?? activeId;
}

/**
 * Resolve rail selection when inputs change.
 * Follow the stage only when `activeId` itself moves (Next / open / peer host).
 * Vote-count `items` refreshes must keep a pending rail tap.
 */
export function nextRailSelection(opts: {
  current: string | null;
  activeId: string | null;
  prevActiveId: string | null | undefined;
  items: RailItem[];
}): string | null {
  const { current, activeId, prevActiveId, items } = opts;
  const activeMoved = prevActiveId !== activeId;
  if (activeMoved && activeId && items.some((i) => i.id === activeId)) {
    return activeId;
  }
  if (current && items.some((i) => i.id === current)) return current;
  return activeId ?? items[0]?.id ?? null;
}

export function useQuestionRail({
  items,
  activeId,
  ended,
  snapshot,
}: {
  items: RailItem[];
  activeId: string | null;
  ended: boolean;
  snapshot: HostSnapshot | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // undefined = first pass. Adjust during render so Next doesn't paint one frame behind.
  const [prevActiveId, setPrevActiveId] = useState<string | null | undefined>(undefined);

  let effectiveSelectedId = selectedId;
  if (activeId !== prevActiveId) {
    effectiveSelectedId = nextRailSelection({
      current: selectedId,
      activeId,
      prevActiveId,
      items,
    });
    setPrevActiveId(activeId);
    if (effectiveSelectedId !== selectedId) setSelectedId(effectiveSelectedId);
  } else if (selectedId && !items.some((i) => i.id === selectedId)) {
    effectiveSelectedId = activeId ?? items[0]?.id ?? null;
    if (effectiveSelectedId !== selectedId) setSelectedId(effectiveSelectedId);
  } else if (!selectedId && items.length > 0) {
    effectiveSelectedId = activeId ?? items[0]?.id ?? null;
    setSelectedId(effectiveSelectedId);
  }

  const selected = useMemo(
    () => items.find((i) => i.id === effectiveSelectedId) ?? null,
    [items, effectiveSelectedId],
  );

  const selectedIndex = items.findIndex((i) => i.id === effectiveSelectedId);
  const isBrowsing = effectiveSelectedId !== null && effectiveSelectedId !== activeId;
  const focusId = focusInteractionId(effectiveSelectedId, activeId);

  const goTo = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) setSelectedId(item.id);
    },
    [items],
  );

  const prev = useCallback(() => goTo(selectedIndex - 1), [goTo, selectedIndex]);
  const next = useCallback(() => goTo(selectedIndex + 1), [goTo, selectedIndex]);

  const canOpenOnStage = useCallback(
    (id: string | null) => canOpenQuestionOnStage(id, snapshot, items, ended),
    [ended, items, snapshot],
  );

  return {
    selectedId: effectiveSelectedId,
    setSelectedId,
    selected,
    selectedIndex,
    focusId,
    isBrowsing,
    goTo,
    prev,
    next,
    canOpenOnStage,
  };
}
