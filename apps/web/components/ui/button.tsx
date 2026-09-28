import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'bg-raised text-fg hover:bg-line',
  ghost: 'text-muted hover:bg-raised hover:text-fg',
  outline: 'border border-line text-fg hover:border-muted',
} as const;

const SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
  icon: 'size-10',
  'icon-sm': 'size-8',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
}

/** Interactive controls are pills; see the shape rule in globals.css. */
export function Button({
  variant = 'secondary',
  size = 'md',
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium transition-[color,background-color,border-color,transform] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[1.15em] [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
