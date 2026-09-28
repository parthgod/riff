import type { ReactNode } from 'react';
import { PlayerRuntime } from '@/components/player/player-runtime';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/shell/app-shell';
import { PlayerShortcuts } from '@/components/shell/player-shortcuts';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <PlayerRuntime />
      <PlayerShortcuts />
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
