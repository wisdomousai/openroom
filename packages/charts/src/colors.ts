/** Categorical chart tokens — same roles as @openroom/ui / shadcn. */
export const CHART_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export function chartColor(index: number): string {
  const base = CHART_VARS[index % CHART_VARS.length] as string;
  const cycle = Math.floor(index / CHART_VARS.length);
  if (cycle === 0) return base;
  return `color-mix(in oklab, ${base} ${Math.max(45, 100 - cycle * 28)}%, var(--foreground))`;
}
