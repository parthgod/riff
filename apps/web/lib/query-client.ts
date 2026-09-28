import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

/** Client errors (4xx) are final; server and network errors get two more tries. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  !(error instanceof ApiRequestError && error.status < 500) && failureCount < 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}

/** A short, user-facing description of a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'UPSTREAM_TIMEOUT') return 'The music source took too long to answer.';
    if (error.code === 'UPSTREAM_ERROR') return 'The music source is having trouble right now.';
    if (error.code === 'NOT_FOUND') return 'This page doesn’t exist, or was removed.';
    return error.message;
  }
  return 'Could not reach Riff. Check your connection.';
}
