import { isSupportedPair, type SpaceLanguages } from './languages.js';

export const WORKSPACE_EXPERIENCES = ['tutoring', 'classroom', 'training'] as const;
export type WorkspaceExperience = (typeof WORKSPACE_EXPERIENCES)[number];

export function isWorkspaceExperience(value: unknown): value is WorkspaceExperience {
  return WORKSPACE_EXPERIENCES.some((experience) => experience === value);
}

/** Experience affects workspace chrome and starters, never permissions or deck tools. */
export interface SpaceSettings {
  experience: WorkspaceExperience;
  languages?: SpaceLanguages;
}

/** Narrow stored/untrusted settings without coupling language configuration to experience. */
export function parseSpaceSettings(value: unknown): SpaceSettings {
  const settings: SpaceSettings = { experience: 'classroom' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return settings;
  const raw = value as Record<string, unknown>;
  if (isWorkspaceExperience(raw.experience)) settings.experience = raw.experience;
  const pair = raw.languages;
  if (pair !== null && typeof pair === 'object' && !Array.isArray(pair)) {
    const { taught, native } = pair as Record<string, unknown>;
    if (typeof taught === 'string' && typeof native === 'string' && isSupportedPair(taught, native)) {
      settings.languages = { taught, native };
    }
  }
  return settings;
}

export function readSpaceSettings(source: string | null): SpaceSettings {
  try { return parseSpaceSettings(source === null ? null : JSON.parse(source)); }
  catch { return parseSpaceSettings(null); }
}
