'use client';

import type { PlaylistDetail } from '@riff/api';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useUpdatePlaylist } from '@/lib/queries/playlists';

export function EditPlaylistDialog({
  playlist,
  children,
}: {
  playlist: PlaylistDetail;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdatePlaylist(playlist.id);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    if (!name) return;
    update.mutate({
      name,
      description: String(form.get('description')).trim() || null,
      isPublic: form.get('isPublic') === 'on',
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Edit details">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              required
              maxLength={100}
              defaultValue={playlist.name}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              maxLength={300}
              rows={3}
              defaultValue={playlist.description ?? ''}
              className="resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-faint hover:border-faint focus-visible:border-accent"
              placeholder="Optional"
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={playlist.isPublic}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              <span className="block font-medium">Public</span>
              <span className="block text-muted">
                Anyone signed in to this Riff with the link can see it.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
