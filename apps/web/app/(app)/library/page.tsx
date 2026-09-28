'use client';

import { Plus } from 'lucide-react';
import { CreatePlaylistDialog } from '@/components/shell/create-playlist-dialog';
import { LibraryList } from '@/components/shell/library-list';
import { Button } from '@/components/ui/button';

/** The phone's Library tab (the sidebar shows the same list on larger screens). */
export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-4 px-2 pt-4 pb-10 md:px-6">
      <div className="flex items-center justify-between px-2">
        <h1 className="font-bold text-3xl tracking-tight">Your library</h1>
        <CreatePlaylistDialog>
          <Button variant="secondary" size="sm">
            <Plus /> New playlist
          </Button>
        </CreatePlaylistDialog>
      </div>
      <LibraryList />
    </div>
  );
}
