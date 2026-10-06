const CHART_SLOTS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

export type BadgeChart = (typeof CHART_SLOTS)[number];

/** One or two letters for an initials badge. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const word = parts[0]!;
    return word.slice(0, word.length === 1 ? 1 : 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

/** First word — "Camille D." → "Camille". */
export function givenName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function possessive(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return name;
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

/** Stable results-palette slot for a folder or person id. */
export function badgeChart(id: string): BadgeChart {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash + id.charCodeAt(i)) % CHART_SLOTS.length;
  return CHART_SLOTS[hash] ?? 'chart-1';
}
