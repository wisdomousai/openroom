import { resolveRevealOrder, type OutlineStep, type Interaction } from '@openroom/schema';
import type { HostSnapshot } from '../types';

export function canAdvanceOutline(outline: HostSnapshot['outline']): boolean {
  if (!outline) return false;
  const step = outline.content.steps[outline.currentStepIndex];
  if (!step) return false;
  const groups = resolveRevealOrder(step as OutlineStep, outline.content.interactions as Interaction[]).length;
  return (outline.shownGroups ?? groups) < groups || outline.content.steps.slice(outline.currentStepIndex + 1).some((next) => !next.breakoutOf);
}

export function canRetreatOutline(outline: HostSnapshot['outline']): boolean {
  if (!outline) return false;
  const step = outline.content.steps[outline.currentStepIndex];
  if (!step) return false;
  const groups = resolveRevealOrder(step as OutlineStep, outline.content.interactions as Interaction[]).length;
  return (outline.shownGroups ?? groups) > 1 || outline.content.steps.slice(0, outline.currentStepIndex).some((previous) => !previous.breakoutOf);
}
