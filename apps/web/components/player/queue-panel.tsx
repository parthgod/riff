'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QueueItem } from '@riff/core';
import { GripVertical, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { Equalizer } from '@/components/tracks/equalizer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { artistNames } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';

/** Where a dragged queued item lands: the index of the item it was dropped on. */
export function queueDropIndex(
  upNext: readonly QueueItem[],
  overUid: string | null,
): number | null {
  if (overUid === null) return null;
  const index = upNext.findIndex((item) => item.uid === overUid);
  return index < 0 ? null : index;
}

function Row({
  item,
  playing,
  current = false,
  sortable = false,
}: {
  item: QueueItem;
  playing?: boolean;
  current?: boolean;
  sortable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
    disabled: !sortable,
  });
  const { track } = item;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center gap-2 rounded-lg p-1.5 hover:bg-raised',
        isDragging && 'relative z-10 bg-raised shadow-lg shadow-black/40',
      )}
    >
      {sortable && (
        <button
          type="button"
          aria-label={`Reorder ${track.title}`}
          className="cursor-grab touch-none rounded p-1 text-faint hover:text-fg"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        type="button"
        disabled={current}
        onClick={() => player.actions.jumpTo(item.uid)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={current ? `${track.title}, now playing` : `Play ${track.title}`}
      >
        <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', current && 'text-accent')}>
            {track.title}
          </span>
          <span className="block truncate text-muted text-xs">
            {artistNames(track.artists) || 'Live radio'}
          </span>
        </span>
        {current && <Equalizer playing={playing ?? false} className="mr-2" />}
      </button>
      {!current && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          aria-label={`Remove ${track.title} from the queue`}
          onClick={() => player.actions.removeFromQueue(item.uid)}
        >
          <X />
        </Button>
      )}
    </li>
  );
}

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1.5 pt-4 pb-2">
      <h3 className="font-semibold text-sm">{children}</h3>
      {action}
    </div>
  );
}

/** Now playing, the user's queue (drag to reorder), then the rest of the context. */
export function QueuePanel() {
  // Select stable references only; a derived array here would re-render forever.
  const { current, upNext, order, index, contextName, playing } = usePlayer(
    useShallow((s) => ({
      current: s.queue.current,
      upNext: s.queue.upNext,
      order: s.queue.order,
      index: s.queue.index,
      contextName: s.queue.context?.name ?? null,
      playing: s.status === 'playing',
    })),
  );
  const following = order.slice(index + 1);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!current && upNext.length === 0) {
    return (
      <p className="px-1.5 py-8 text-center text-muted text-sm">
        Your queue is empty. Play something, or use “Add to queue” on any track.
      </p>
    );
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const to = queueDropIndex(upNext, over ? String(over.id) : null);
    if (to !== null && active.id !== over?.id) player.actions.moveInQueue(String(active.id), to);
  };

  return (
    <div className="flex flex-col">
      {current && (
        <>
          <Heading>Now playing</Heading>
          <ul>
            <Row item={current} current playing={playing} />
          </ul>
        </>
      )}
      {upNext.length > 0 && (
        <>
          <Heading
            action={
              <Button variant="ghost" size="sm" onClick={() => player.actions.clearUpNext()}>
                Clear
              </Button>
            }
          >
            Next in queue
          </Heading>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={upNext.map((item) => item.uid)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {upNext.map((item) => (
                  <Row key={item.uid} item={item} sortable />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}
      {following.length > 0 && (
        <>
          <Heading>Next from {contextName ?? 'this list'}</Heading>
          <ul>
            {following.map((item) => (
              <Row key={item.uid} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
