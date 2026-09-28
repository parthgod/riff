'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { createQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-center"
        offset={{ bottom: 'calc(var(--player-h) + 1rem)' }}
        mobileOffset={{ bottom: 'calc(var(--tabbar-h) + var(--mini-h) + var(--safe-b) + 1rem)' }}
        toastOptions={{ className: '!bg-raised !text-fg !border-line' }}
      />
    </QueryClientProvider>
  );
}
