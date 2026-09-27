import type { FetchLike } from '../http';

export interface FakeRoute {
  /** Substring or pattern matched against the full request URL. First match wins. */
  match: string | RegExp;
  status?: number;
  /** Serialised as the JSON response body. */
  json?: unknown;
  /** Raw response body; takes precedence over `json`. */
  text?: string;
  /** Waits before responding; rejects with the signal's reason if aborted meanwhile. */
  delayMs?: number;
  /** Rejects instead of responding (simulates a network failure). */
  error?: Error;
}

export interface FakeFetch extends FetchLike {
  requests: { url: string; headers: Headers }[];
  unmatched: string[];
}

export function fakeFetch(routes: FakeRoute[]): FakeFetch {
  const requests: FakeFetch['requests'] = [];
  const unmatched: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url: input, headers: new Headers(init?.headers) });
    const route = routes.find((r) =>
      typeof r.match === 'string' ? input.includes(r.match) : r.match.test(input),
    );
    if (!route) {
      unmatched.push(input);
      return new Response('no fake route', { status: 501 });
    }
    if (route.delayMs) await sleep(route.delayMs, init?.signal ?? undefined);
    if (route.error) throw route.error;
    const body = route.text ?? (route.json === undefined ? null : JSON.stringify(route.json));
    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(fetch, { requests, unmatched });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
