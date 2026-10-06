/**
 * Pure helpers for save-conflict handling and simple version restore
 * (testable without a DOM).
 */
import { ApiError } from '../api';
import type { Interaction, Session } from '../../../../packages/editor/src/types';

export interface VersionConflict {
  latestVersion: number;
  authorName: string | null;
  latestCreatedAt: number | null;
}

/** Extract the structured E_VERSION_CONFLICT payload from a failed save. */
export function parseVersionConflict(err: unknown): VersionConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as {
    error?: {
      code?: string;
      latestVersion?: number;
      latestAuthor?: { id: string; name: string | null } | null;
      latestCreatedAt?: number | null;
    };
  } | null;
  const e = body?.error;
  if (!e || e.code !== 'E_VERSION_CONFLICT') return null;
  return {
    latestVersion: typeof e.latestVersion === 'number' ? e.latestVersion : 0,
    authorName: e.latestAuthor?.name ?? null,
    latestCreatedAt: e.latestCreatedAt ?? null,
  };
}

/** Title for the "keep my copy" escape hatch, capped like server titles. */
export function keepMyCopyTitle(title: string): string {
  const base = title.trim() === '' ? 'Untitled session' : title.trim();
  const suffix = ' (local copy)';
  const max = 200;
  if (base.length + suffix.length <= max) return `${base}${suffix}`;
  return `${base.slice(0, max - suffix.length)}${suffix}`;
}

/**
 * Copy one interaction from an older version into the current session document:
 * replaces the interaction with the same id, or appends when the id is gone.
 */
export function restoreInteraction(current: Session, restored: Interaction): Session {
  const index = current.interactions.findIndex((i) => i.id === restored.id);
  const interactions =
    index === -1
      ? [...current.interactions, restored]
      : current.interactions.map((i, n) => (n === index ? restored : i));
  return { ...current, interactions };
}

/** True when the interaction differs from its same-id counterpart in `other`. */
export function interactionDiffers(other: Session, interaction: Interaction): boolean {
  const counterpart = other.interactions.find((i) => i.id === interaction.id);
  if (counterpart === undefined) return true;
  return JSON.stringify(counterpart) !== JSON.stringify(interaction);
}
