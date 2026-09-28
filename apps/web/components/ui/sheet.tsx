'use client';

import { Dialog } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Sheet = Dialog.Root;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
export const SheetClose = Dialog.Close;

/** A full-screen dialog (the phone Now Playing view). */
export function SheetContent({ className, ...props }: ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <Dialog.Content
        className={cn(
          'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg outline-none motion-safe:animate-sheet-in',
          className,
        )}
        {...props}
      />
    </Dialog.Portal>
  );
}
