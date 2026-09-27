import { CatalogError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GetJsonOptions {
  /** Upstream name used in errors, e.g. "audius". */
  upstream: string;
  signal?: AbortSignal;
  /** Statuses meaning "no such entity"; they resolve to null. Defaults to [404]. */
  notFoundStatuses?: readonly number[];
}

export interface HttpClient {
  getJson<T>(url: string, options: GetJsonOptions): Promise<T | null>;
}

export function createHttpClient({
  fetch = globalThis.fetch,
  userAgent,
}: {
  fetch?: FetchLike;
  userAgent: string;
}): HttpClient {
  return {
    async getJson<T>(url: string, { upstream, signal, notFoundStatuses = [404] }: GetJsonOptions) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': userAgent },
          signal,
        });
      } catch (error) {
        throw toCatalogError(error, upstream, signal);
      }
      if (notFoundStatuses.includes(response.status)) {
        response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) {
        response.body?.cancel().catch(() => undefined);
        throw new CatalogError(
          'UPSTREAM_ERROR',
          `${upstream} responded with HTTP ${response.status}`,
          {
            upstream,
          },
        );
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw toCatalogError(error, upstream, signal);
      }
    },
  };
}

function isTimeoutError(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'name' in value && value.name === 'TimeoutError'
  );
}

function toCatalogError(error: unknown, upstream: string, signal?: AbortSignal): CatalogError {
  if (isTimeoutError(error) || (signal?.aborted && isTimeoutError(signal.reason))) {
    return new CatalogError('UPSTREAM_TIMEOUT', `${upstream} timed out`, {
      upstream,
      cause: error,
    });
  }
  return new CatalogError('UPSTREAM_ERROR', `${upstream} request failed`, {
    upstream,
    cause: error,
  });
}
