import { badgeChart, initials, type BadgeChart } from '../lib/initials';
import { cn } from '@openroom/ui/utils';

const CHART_BG: Record<BadgeChart, string> = {
  'chart-1': 'bg-[color-mix(in_oklab,var(--chart-1)_18%,var(--background))]',
  'chart-2': 'bg-[color-mix(in_oklab,var(--chart-2)_18%,var(--background))]',
  'chart-3': 'bg-[color-mix(in_oklab,var(--chart-3)_18%,var(--background))]',
  'chart-4': 'bg-[color-mix(in_oklab,var(--chart-4)_18%,var(--background))]',
  'chart-5': 'bg-[color-mix(in_oklab,var(--chart-5)_18%,var(--background))]',
};

interface Props {
  name: string;
  id: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = {
  sm: 'size-[22px] rounded-md text-[11px]',
  md: 'size-[26px] rounded-full text-[11px]',
  lg: 'size-11 rounded-[var(--radius-xl)] text-section',
} as const;

/** Initials use the readable theme foreground on a soft results-palette tint. */
export function PersonBadge({ name, id, size = 'sm', className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-semibold text-foreground',
        SIZE[size],
        CHART_BG[badgeChart(id)],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
