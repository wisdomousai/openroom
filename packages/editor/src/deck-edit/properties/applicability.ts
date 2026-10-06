/**
 * Which properties-pane sections apply right now.
 *
 * The pane shows one of two things and nothing else:
 *
 *   nothing selected   properties of the slide itself, and only the ones its
 *                      kind can actually carry
 *   a part selected    properties of that part
 *
 * So this is derived from the kind's capability helpers — `LAYOUTS_FOR_KIND`,
 * `kindCanCarryPicture`, `stepElements` — never from a hardcoded kind list, and
 * a slide-level section is off the moment a part is selected. A control with a
 * single choice is not a choice: a one-layout kind (`blank`, `join`) gets no
 * layout picker, and a slide with fewer than two parts gets no reveal order.
 */

import {
  OUTLINE_LAYOUTS,
  LAYOUTS_FOR_KIND,
  kindCanCarryElements,
  kindCanCarryPicture,
  stepElements,
  stepPicture,
  type OutlineLayout,
  type OutlineStep,
  type OutlineStepKind,
} from '@openroom/schema';

import { hasMinutes } from '../outline-edit';

/** The layouts a kind can claim, in pane order. */
export function layoutChoicesFor(kind: OutlineStepKind): readonly OutlineLayout[] {
  return OUTLINE_LAYOUTS.filter((layout) => LAYOUTS_FOR_KIND[kind].includes(layout));
}

/** What the current `partKey` names. `slide` is "nothing selected". */
export type PaneSelection = 'slide' | 'picture' | 'element' | 'part';

export function paneSelection(partKey: string | null): PaneSelection {
  if (partKey === null) return 'slide';
  if (partKey === 'image') return 'picture';
  if (partKey.startsWith('el-')) return 'element';
  return 'part';
}

export interface PaneSections {
  /** The join slide's own note. Its QR is session state, so it has no parts. */
  join: boolean;
  layout: boolean;
  timing: boolean;
  timerAuthoring: boolean;
  reveal: boolean;
  picture: boolean;
  element: boolean;
  part: boolean;
}

const NONE: PaneSections = {
  join: false,
  layout: false,
  timing: false,
  timerAuthoring: false,
  reveal: false,
  picture: false,
  element: false,
  part: false,
};

export function paneSections({
  step,
  partKey,
  groups,
}: {
  step: OutlineStep;
  partKey: string | null;
  /** Reveal order of this step, as `resolveRevealOrder` derives it. */
  groups: readonly (readonly string[])[];
}): PaneSections {
  const selection = paneSelection(partKey);

  if (selection === 'picture') {
    return {
      ...NONE,
      picture: kindCanCarryPicture(step.kind) && stepPicture(step) !== undefined,
    };
  }
  if (selection === 'element') {
    const id = partKey === null ? '' : partKey.slice(3);
    return {
      ...NONE,
      element:
        kindCanCarryElements(step.kind) && stepElements(step).some((item) => item.id === id),
    };
  }
  if (selection === 'part') return { ...NONE, part: true };

  if (step.kind === 'join') return { ...NONE, join: true };

  const parts = groups.reduce((sum, group) => sum + group.length, 0);
  return {
    ...NONE,
    layout: layoutChoicesFor(step.kind).length > 1,
    timing: hasMinutes(step),
    timerAuthoring: step.kind === 'timer',
    reveal: parts > 1,
  };
}
