import * as React from 'react';
import { cn } from '../../lib/utils';

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: '', dark: '.dark' } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }

  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children?: React.ReactNode;
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        data-chart-initial-width={initialDimension.width}
        data-chart-initial-height={initialDimension.height}
        className={cn('flex justify-center text-xs', className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        {children}
      </div>
    </ChartContext.Provider>
  );
}

export const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, itemConfig]) => itemConfig.theme ?? itemConfig.color);

  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  );
};

export interface ChartTooltipPayload {
  dataKey?: string | number;
  name?: React.ReactNode;
  value?: unknown;
  color?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'content'> {
  active?: boolean;
  payload?: readonly ChartTooltipPayload[];
  label?: React.ReactNode;
  content?: React.ReactNode | ((props: ChartTooltipProps) => React.ReactNode);
  [key: string]: unknown;
}

/** Compatibility surface for callers that used the former chart alias. */
export function ChartTooltip({
  active = false,
  payload,
  content,
  className,
  ...props
}: ChartTooltipProps) {
  if (typeof content === 'function') {
    return <>{content({ active, payload, ...props })}</>;
  }
  if (content) return <>{content}</>;
  if (!active || !payload?.length) return null;

  return (
    <div
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
      className={cn(
        'grid min-w-32 items-start gap-1.5 rounded-[var(--radius)] border border-border bg-background px-2.5 py-1.5 text-xs',
        className,
      )}
    >
      {payload.map((item, index) => (
        <div key={index} className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{item.name ?? item.dataKey}</span>
          <span className="font-mono font-medium tabular-nums">{String(item.value ?? '')}</span>
        </div>
      ))}
    </div>
  );
}

export interface ChartTooltipContentProps extends ChartTooltipProps {
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelKey?: string;
  labelFormatter?: (label: unknown, payload: readonly ChartTooltipPayload[]) => React.ReactNode;
  formatter?: (
    value: unknown,
    name: React.ReactNode,
    item: ChartTooltipPayload,
    index: number,
    payload: unknown,
  ) => React.ReactNode;
  labelClassName?: string;
  color?: string;
}

export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  ...props
}: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const tooltipLabel = hideLabel
    ? null
    : labelFormatter
      ? labelFormatter(label, payload)
      : typeof label === 'string' && config[label]?.label
        ? config[label]?.label
        : label;

  return (
    <div
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
      className={cn(
        'grid min-w-32 items-start gap-1.5 rounded-[var(--radius)] border border-border bg-background px-2.5 py-1.5 text-xs',
        className,
      )}
    >
      {tooltipLabel ? <div className={cn('font-medium', labelClassName)}>{tooltipLabel}</div> : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = String(nameKey ? item[nameKey as keyof ChartTooltipPayload] : item.name ?? item.dataKey ?? 'value');
            const itemConfig = config[key];
            const indicatorColor = color ?? item.color ?? 'var(--foreground)';
            const itemName = itemConfig?.label ?? item.name ?? item.dataKey;

            return (
              <div key={index} className="flex w-full flex-wrap items-center gap-2">
                {!hideIndicator ? (
                  <span
                    className={cn(
                      'shrink-0 rounded-none',
                      indicator === 'dot' && 'size-2.5',
                      indicator === 'line' && 'h-0.5 w-3',
                      indicator === 'dashed' && 'w-3 border-t border-dashed',
                    )}
                    style={{ backgroundColor: indicator === 'dashed' ? 'transparent' : indicatorColor, borderColor: indicatorColor }}
                  />
                ) : null}
                {formatter ? (
                  formatter(item.value, itemName, item, index, item.payload)
                ) : (
                  <div className="flex flex-1 justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">{itemName}</span>
                    <span className="font-mono font-medium tabular-nums">{String(item.value ?? '')}</span>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export interface ChartLegendPayload {
  dataKey?: string | number;
  value?: React.ReactNode;
  color?: string;
  type?: string;
}

export interface ChartLegendProps extends React.HTMLAttributes<HTMLDivElement> {
  payload?: readonly ChartLegendPayload[];
  verticalAlign?: 'top' | 'middle' | 'bottom';
  [key: string]: unknown;
}

/** Compatibility surface for callers that used the former chart alias. */
export function ChartLegend({ payload, ...props }: ChartLegendProps) {
  if (!payload?.length) return null;
  return <ChartLegendContent payload={payload} {...props} />;
}

export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
  ...props
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean;
  nameKey?: string;
  payload?: readonly ChartLegendPayload[];
  verticalAlign?: 'top' | 'middle' | 'bottom';
}) {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div
      {...props}
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item, index) => {
          const key = String(nameKey ? item[nameKey as keyof ChartLegendPayload] : item.dataKey ?? 'value');
          const itemConfig = config[key];
          return (
            <div key={index} className="flex items-center gap-1.5">
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <span className="size-2 shrink-0 rounded-none" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label ?? item.value ?? item.dataKey}
            </div>
          );
        })}
    </div>
  );
}

export { useChart };
