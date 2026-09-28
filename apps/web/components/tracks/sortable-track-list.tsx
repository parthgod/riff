'use client';

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlaylistEntry } from '@riff/api';
import type { QueueContext, Track } from '@riff/core';
import { GripVertical } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { player } from '@/lib/player/instance';
import { afterIdForMove } from '@/lib/queries/playlists';
import { COLUMNS, TrackRow, useNowPlaying } from './track-list';

interface SortableTrackListProps {
  entries: readonly PlaylistEntry[];
  context: QueueContext;
  /** Move `entryId` right after `afterEntryId` (null: to the top). */
  onMove: (entryId: string, afterEntryId: string | null) => void;
  onRemove: (entryId: string) => void;
}

/**
 * A playlist the user owns: rows reorder by dragging the handle, or with the keyboard
 * (focus the handle, Space, arrow keys, Space). Not virtualised: playlists are user-sized.
 */
export function SortableTrackList({ entries, context, onMove, onRemove }: SortableTrackListProps) {
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const tracks = useMemo(() => entries.map((entry) => entry.track), [entries]);
  const { currentId, playing } = useNowPlaying();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Spoken during keyboard drags; the defaults would read out entry UUIDs.
  const announcements = useMemo((): Announcements => {
    const title = (id: string | number) => entries.find((entry) => entry.id === id)?.track.title;
    const position = (id: string | number) =>
      `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
    return {
      onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `${title(active.id)} is at ${position(over.id)}.` : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `${title(active.id)} dropped at ${position(over.id)}.`
          : `${title(active.id)} dropped.`,
      onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
    };
  }, [entries, ids]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onMove(String(active.id), afterIdForMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol aria-label={context.name} className="mt-2 flex flex-col">
          {entries.map((entry, index) => (
            <SortableEntry
              key={entry.id}
              id={entry.id}
              track={entry.track}
              index={index}
              isCurrent={entry.track.id === currentId}
              playing={playing}
              onPlay={() => {
                if (entry.track.id === currentId) player.actions.togglePlay();
                else player.actions.playContext(tracks, index, context);
              }}
              onRemove={() => onRemove(entry.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

interface SortableEntryProps {
  id: string;
  track: Track;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

function SortableEntry({
  id,
  track,
  index,
  isCurrent,
  playing,
  onPlay,
  onRemove,
}: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <li
      ref={setNodeRef}
      aria-current={isCurrent ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/entry flex items-center rounded-lg',
        isDragging && 'relative z-20 bg-raised shadow-black/50 shadow-xl',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${track.title}`}
        className="grid h-14 w-7 shrink-0 cursor-grab touch-none place-items-center rounded text-faint hover:text-fg active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <TrackRow
          track={track}
          index={index}
          columns={COLUMNS}
          showAlbum={false}
          isCurrent={isCurrent}
          playing={playing}
          onPlay={onPlay}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}
