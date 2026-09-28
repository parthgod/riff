'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useCreatePlaylist } from '@/lib/queries/playlists';

/** Wraps a trigger button; creating a playlist opens it. */
export function CreatePlaylistDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const create = useCreatePlaylist();
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) return;
    create.mutate(
      { name },
      {
        onSuccess: (playlist) => {
          setOpen(false);
          router.push(`/playlist/${playlist.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="New playlist">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="playlist-name">Name</Label>
            <Input id="playlist-name" name="name" required maxLength={100} autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
