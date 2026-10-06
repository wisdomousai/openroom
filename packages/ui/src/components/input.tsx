import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils.js';

/**
 * A field is signalled by its fill and a focus bottom-border, not by a
 * heavier stroke. `--input` is only slightly darker than `--border`.
 *
 * - `default` — a committed field holding or awaiting a real value.
 * - `add` — the inline-add affordance: the empty "new folder" / "new tag" /
 *   "new block" row that sits in a list and is not yet anything. Its stroke is
 *   **dashed**, which reads as provisional without adding a colour, an icon or
 *   a second control. Still 1px, still `--input`, still flat.
 */
export const inputVariants = cva(
  [
    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-secondary transition-colors',
    'placeholder:text-muted-foreground',
    'focus-visible:border-b-2 focus-visible:border-b-primary focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        default: '',
        add: 'border-dashed',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, variant, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  );
});
