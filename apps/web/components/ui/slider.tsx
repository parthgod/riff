'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Accessible name of the thumb (the element with role="slider"). */
  label: string;
  /** Spoken value, e.g. "1:05 of 3:20". */
  valueText?: string;
}

/** A single-thumb slider: the filled range turns ember on hover and focus. */
export function Slider({ className, label, valueText, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'group relative flex h-4 w-full cursor-pointer touch-none select-none items-center data-disabled:cursor-default data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-fg transition-colors group-hover:bg-accent group-has-focus-visible:bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className="block size-3 rounded-full bg-fg opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
      />
    </SliderPrimitive.Root>
  );
}
