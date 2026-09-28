'use client';

import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const content =
  'z-50 min-w-48 overflow-hidden rounded-xl border border-line bg-raised p-1 text-sm shadow-xl shadow-black/40 motion-safe:animate-pop-in';
const item =
  'relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-fg outline-none data-disabled:pointer-events-none data-highlighted:bg-line data-disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuSub = DropdownMenu.Sub;

export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content sideOffset={sideOffset} className={cn(content, className)} {...props} />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(item, className)} {...props} />;
}

export function MenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(item, 'data-[state=open]:bg-line', className)}
      {...props}
    />
  );
}

export function MenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        className={cn(content, 'max-h-72 overflow-y-auto', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label className={cn('px-2.5 py-2 text-muted text-xs', className)} {...props} />
  );
}

export const ContextMenuRoot = ContextMenu.Root;
export const ContextMenuTrigger = ContextMenu.Trigger;
export const ContextMenuSub = ContextMenu.Sub;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.Content>) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={cn(content, className)} {...props} />
    </ContextMenu.Portal>
  );
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenu.Item>) {
  return <ContextMenu.Item className={cn(item, className)} {...props} />;
}

export function ContextMenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.SubTrigger>) {
  return (
    <ContextMenu.SubTrigger
      className={cn(item, 'data-[state=open]:bg-line', className)}
      {...props}
    />
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.SubContent>) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.SubContent
        className={cn(content, 'max-h-72 overflow-y-auto', className)}
        {...props}
      />
    </ContextMenu.Portal>
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.Separator>) {
  return <ContextMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}
