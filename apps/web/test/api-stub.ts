import { vi } from 'vitest';

export interface StubRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Route = ((request: StubRequest) => Response | Promise<Response>) | object | null;

/** A JSON error in the API's contract. */
export const apiError = (status: number, code: string, message = code) =>
  Response.json({ error: { code, message } }, { status });

export const noContent = () => new Response(null, { status: 204 });

/**
 * Replaces `fetch` with a route table keyed by `"METHOD /path"` (query strings ignored).
 * A plain value is returned as JSON. An unmatched request throws, failing the test loudly.
 */
export function stubApi(routes: Record<string, Route>) {
  const requests: StubRequest[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const request: StubRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const key = `${request.method} ${request.path}`;
    if (!(key in routes)) throw new Error(`Unexpected request: ${key}`);
    const route = routes[key];
    return typeof route === 'function' ? route(request) : Response.json(route);
  });
  vi.stubGlobal('fetch', fetch);
  return { requests };
}
