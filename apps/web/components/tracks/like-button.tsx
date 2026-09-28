'use client';

import type { Track } from '@riff/core';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';

/** Heart toggle for Liked Songs. Live stations can't be liked, so they get none. */
export function LikeButton({ track, className }: { track: Track; className?: string }) {
  const liked = useLikedIds().has(track.id);
  const toggle = useToggleLike();
  if (track.isLive) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(liked && 'text-accent hover:text-accent', className)}
      aria-label={
        liked ? `Remove ${track.title} from Liked Songs` : `Save ${track.title} to Liked Songs`
      }
      aria-pressed={liked}
      onClick={(event) => {
        event.stopPropagation();
        toggle.mutate({ track, like: !liked });
      }}
    >
      <Heart className={cn(liked && 'fill-current')} />
    </Button>
  );
}
