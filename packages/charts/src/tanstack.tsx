import { defineChart } from '@tanstack/charts';
import type {
  ChartValue,
  DomChartDefinition,
} from '@tanstack/charts';
import { Chart } from '@tanstack/react-charts';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from './lib/utils';
import { chartMotion } from './motion';

export {
  barX,
  barY,
  group,
  ruleX,
  ruleY,
  text,
} from '@tanstack/charts';
export {
  angleGrid,
  pie,
  polar,
  radialArc,
  radialBarAngle,
  radialBarRadius,
  radialGrid,
  radialText,
} from '@tanstack/charts/polar';
export { scaleBand, scaleLinear } from './scales';

/** Shared theme tokens keep the TanStack SVG renderer aligned with OpenRoom. */
export const chartTheme = {
  foreground: 'var(--foreground)',
  muted: 'var(--muted-foreground)',
  grid: 'var(--border)',
  background: 'var(--background)',
  palette: [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
  ],
} as const;

export function chartAnimation(reduced?: boolean) {
  const motion = chartMotion(reduced);
  return motion.isAnimationActive
    ? { duration: motion.animationDuration, respectReducedMotion: true as const }
    : false;
}

/** The wall type ramp's SVG sizes, in px (DESIGN.md, LD12). */
export interface WallType {
  /** Counts and percents drawn on the marks. */
  value: number;
  /** Axis numbers. */
  tick: number;
}

function wallLength(style: CSSStyleDeclaration, name: string): number | null {
  // The stage registers the tokens as lengths, so they compute to px there.
  const raw = style.getPropertyValue(name).trim();
  const px = raw.endsWith('px') ? Number.parseFloat(raw) : Number.NaN;
  return px > 0 ? Math.round(px * 10) / 10 : null;
}

/**
 * Reads the wall type ramp at the element the ref is on, again on every resize.
 * Null off the wall (no stage tokens), where a chart keeps its own sizes.
 */
export function useWallType<T extends Element>() {
  const ref = useRef<T>(null);
  const [type, setType] = useState<WallType | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const style = getComputedStyle(element);
      const value = wallLength(style, '--wall-value');
      const tick = wallLength(style, '--wall-tick');
      setType((current) =>
        value === null || tick === null
          ? null
          : current?.value === value && current.tick === tick
            ? current
            : { value, tick },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, type] as const;
}

export function TanStackChart<
  TDatum,
  TXValue extends ChartValue,
  TYValue extends ChartValue,
>({
  definition,
  ariaLabel,
  initialHeight = 320,
  initialWidth = 640,
  className,
}: {
  definition: DomChartDefinition<TDatum, TXValue, TYValue>;
  ariaLabel: string;
  initialHeight?: number;
  initialWidth?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(initialHeight);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const updateHeight = () => {
      const nextHeight = Math.round(container.getBoundingClientRect().height);
      if (nextHeight > 0) setHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={cn('or-tanstack-chart', className)}>
      <Chart
        definition={definition}
        ariaLabel={ariaLabel}
        height={height}
        initialWidth={initialWidth}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

export { defineChart };
