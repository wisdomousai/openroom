import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils.js';

type TabsStrip = 'default' | 'ribbon';

const TabsStripContext = React.createContext<TabsStrip>('default');

export const tabsListVariants = cva('inline-flex bg-chrome text-foreground', {
  variants: {
    variant: {
      default: 'h-9 items-center justify-center gap-0.5 rounded-md p-1',
      ribbon: 'h-8 items-end justify-start gap-0.5 p-0',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const tabsTriggerVariants = cva(
  [
    'inline-flex items-center justify-center whitespace-nowrap px-2.5 font-normal text-secondary transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-[state=active]:bg-card data-[state=active]:font-semibold',
  ],
  {
    variants: {
      variant: {
        default: 'rounded-md py-1 hover:bg-background',
        ribbon:
          'h-8 rounded-lg px-3.5 hover:bg-background data-[state=active]:rounded-b-none data-[state=active]:rounded-t-lg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> &
    VariantProps<typeof tabsListVariants>
>(function TabsList({ className, variant = 'default', ...props }, ref) {
  return (
    <TabsStripContext.Provider value={variant ?? 'default'}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsStripContext.Provider>
  );
});

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> &
    VariantProps<typeof tabsTriggerVariants>
>(function TabsTrigger({ className, variant, ...props }, ref) {
  const strip = React.useContext(TabsStripContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ variant: variant ?? strip }), className)}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-3 focus-visible:outline-none', className)}
      {...props}
    />
  );
});
