'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { authClient } from '@/lib/auth-client';
import { player } from '@/lib/player/instance';
import { clearSavedPlayer } from '@/lib/player/persistence';
import { useMe } from '@/lib/queries/library';

export function UserMenu() {
  const me = useMe();
  const client = useQueryClient();
  const router = useRouter();
  const initial = me.data?.name.trim().charAt(0).toUpperCase() || '?';

  async function signOut() {
    await authClient.signOut().catch(() => {
      // Signing out of an expired session fails; the local cleanup below still applies.
    });
    player.actions.reset();
    try {
      clearSavedPlayer(window.localStorage);
    } catch {
      // Storage unavailable: nothing was saved.
    }
    client.clear();
    router.replace('/sign-in');
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="size-9 font-semibold text-sm"
          aria-label={me.data ? `Account: ${me.data.name}` : 'Account'}
        >
          {initial}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        {me.data && (
          <MenuLabel>
            <span className="block truncate font-medium text-fg text-sm">{me.data.name}</span>
            <span className="block truncate">{me.data.email}</span>
          </MenuLabel>
        )}
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
