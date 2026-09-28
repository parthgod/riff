'use client';

import type { Track } from '@riff/core';
import {
  Disc3,
  ExternalLink,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';
import { toast } from 'sonner';
import { SOURCE_NAMES } from '@/components/player/now-playing';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from '@/components/ui/menu';
import { player } from '@/lib/player/instance';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';
import { useAddToPlaylist, usePlaylists } from '@/lib/queries/playlists';

interface MenuKit {
  Item: ComponentType<{ onSelect?: () => void; disabled?: boolean; children: ReactNode }>;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ children: ReactNode }>;
  Separator: ComponentType;
}

/** The same items render in the "…" dropdown and the right-click menu. */
export const dropdownKit: MenuKit = {
  Item: MenuItem,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
  Separator: MenuSeparator,
};

export const contextKit: MenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Separator: ContextMenuSeparator,
};

export interface TrackMenuProps {
  track: Track;
  /** Shown on a playlist the user owns. */
  onRemove?: () => void;
}

export function TrackMenuItems({ track, onRemove, kit }: TrackMenuProps & { kit: MenuKit }) {
  const { Item, Sub, SubTrigger, SubContent, Separator } = kit;
  const router = useRouter();
  const liked = useLikedIds().has(track.id);
  const toggleLike = useToggleLike();
  const playlists = usePlaylists();
  const addToPlaylist = useAddToPlaylist();
  const artist = track.artists[0];

  return (
    <>
      <Item
        onSelect={() => {
          player.actions.playNext([track]);
          toast('Playing next');
        }}
      >
        <ListStart /> Play next
      </Item>
      <Item
        onSelect={() => {
          player.actions.addToQueue([track]);
          toast('Added to queue');
        }}
      >
        <ListEnd /> Add to queue
      </Item>
      {!track.isLive && (
        <>
          <Separator />
          <Sub>
            <SubTrigger>
              <ListPlus /> Add to playlist
            </SubTrigger>
            <SubContent>
              {playlists.data?.length ? (
                playlists.data.map((playlist) => (
                  <Item
                    key={playlist.id}
                    onSelect={() => addToPlaylist.mutate({ playlist, trackIds: [track.id] })}
                  >
                    {playlist.name}
                  </Item>
                ))
              ) : (
                <Item disabled>{playlists.isPending ? 'Loading…' : 'No playlists yet'}</Item>
              )}
            </SubContent>
          </Sub>
          <Item onSelect={() => toggleLike.mutate({ track, like: !liked })}>
            <Heart /> {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
          </Item>
        </>
      )}
      {onRemove && (
        <Item onSelect={onRemove}>
          <Trash2 /> Remove from this playlist
        </Item>
      )}
      <Separator />
      {artist && (
        <Item onSelect={() => router.push(`/artist/${artist.id}`)}>
          <UserRound /> Go to artist
        </Item>
      )}
      {track.album && (
        <Item onSelect={() => router.push(`/collection/${track.album?.id}`)}>
          <Disc3 /> Go to album
        </Item>
      )}
      {track.permalink && (
        <Item onSelect={() => window.open(track.permalink, '_blank', 'noopener,noreferrer')}>
          <ExternalLink /> Open on {SOURCE_NAMES[track.source]}
        </Item>
      )}
    </>
  );
}
