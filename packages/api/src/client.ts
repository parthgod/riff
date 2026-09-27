import { type ClientRequestOptions, hc } from 'hono/client';
import type { AppType } from './app';

export type { AppType };

/** Typed API client. `baseUrl` points at the API root, e.g. `/api` in the web app. */
export const createApiClient = (baseUrl: string, options?: ClientRequestOptions) =>
  hc<AppType>(baseUrl, options);

export type ApiClient = ReturnType<typeof createApiClient>;
