'use client';

import type { QueueContext } from '@riff/core';
import { ListMusic, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { PlaylistCover } from '@/components/media/covers';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { DeletePlaylistDialog } from '@/components/playlists/delete-playlist-dialog';
import { EditPlaylistDialog } from '@/components/playlists/edit-playlist-dialog';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { SortableTrackList } from '@/components/tracks/sortable-track-list';
import { TrackList } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/format';
import { useMoveEntry, usePlaylist, useRemoveEntry } from '@/lib/queries/playlists';
import { useRouteParam } from '@/lib/route-param';

export default function PlaylistPage() {
  const id = useRouteParam('id');
  const playlist = usePlaylist(id);
  const move = useMoveEntry(id);
  const remove = useRemoveEntry(id);
  const tracks = useMemo(
    () => playlist.data?.entries.map((entry) => entry.track) ?? [],
    [playlist.data],
  );

  if (playlist.isPending) return <PageHeaderSkeleton />;
  if (playlist.isError) {
    return <ErrorState error={playlist.error} onRetry={() => playlist.refetch()} />;
  }

  const data = playlist.data;
  const context: QueueContext = { type: 'playlist', id: data.id, name: data.name };
  const total = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageHeader
        kind={data.isPublic ? 'Public playlist' : 'Playlist'}
        title={data.name}
        cover={<PlaylistCover playlist={data} className="w-full" />}
        tintFrom={data.coverUrl ?? data.covers[0]}
        meta={
          <>
            {data.description && <p className="mb-1 text-muted">{data.description}</p>}
            {`${data.trackCount} ${data.trackCount === 1 ? 'track' : 'tracks'}`}
            {total > 0 && `, ${formatDuration(total)}`}
          </>
        }
      >
        <PlayContextButton tracks={tracks} context={context} />
        {data.isOwner && (
          <>
            <EditPlaylistDialog playlist={data}>
              <Button variant="ghost" size="icon" aria-label="Edit details">
                <Pencil />
              </Button>
            </EditPlaylistDialog>
            <DeletePlaylistDialog playlist={data}>
              <Button variant="ghost" size="icon" aria-label="Delete playlist">
                <Trash2 />
              </Button>
            </DeletePlaylistDialog>
          </>
        )}
      </PageHeader>
      <section className="px-2 md:px-6">
        {data.entries.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title="This playlist is empty"
            action={
              data.isOwner ? (
                <Button asChild variant="primary">
                  <Link href="/search">Find tracks</Link>
                </Button>
              ) : undefined
            }
          >
            {data.isOwner ? (
              <>
                Use <MoreHorizontal className="inline size-4" aria-label="the more options menu" />{' '}
                on any track, then Add to playlist.
              </>
            ) : null}
          </EmptyState>
        ) : data.isOwner ? (
          <SortableTrackList
            entries={data.entries}
            context={context}
            onMove={(entryId, afterEntryId) => move.mutate({ entryId, afterEntryId })}
            onRemove={(entryId) => remove.mutate(entryId)}
          />
        ) : (
          <TrackList tracks={tracks} context={context} rowKeys={data.entries.map((e) => e.id)} />
        )}
      </section>
    </div>
  );
}
