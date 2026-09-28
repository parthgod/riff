'use client';

import type { PlaylistDetail } from '@riff/api';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useDeletePlaylist } from '@/lib/queries/playlists';

export function DeletePlaylistDialog({
  playlist,
  children,
}: {
  playlist: PlaylistDetail;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const remove = useDeletePlaylist();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        title={`Delete “${playlist.name}”?`}
        description="This removes the playlist from your library. It can’t be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="bg-danger text-on-accent hover:bg-danger/90"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(playlist.id, {
                onSuccess: () => {
                  setOpen(false);
                  router.replace('/library');
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
