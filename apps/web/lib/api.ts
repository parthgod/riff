import type { ErrorCode } from '@riff/api';
import { createApiClient } from '@riff/api/client';
import { signInPath } from './redirect';

/** The typed API client. Paths are relative to /api; query values are strings. */
export const api = createApiClient('/api');

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

const redirectToSignIn = () => {
  window.location.assign(signInPath(window.location.pathname + window.location.search));
};

let onUnauthorized: () => void = redirectToSignIn;

/** Replaces what happens on a 401 (tests); `null` restores the redirect to /sign-in. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler ?? redirectToSignIn;
}

/** Resolves a typed-client call to its JSON body, or throws ApiRequestError. */
export async function unwrap<T>(pending: Promise<ApiResponse<T>>): Promise<T> {
  const response = await pending;
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** For routes that answer 204: resolves when the call succeeded, or throws ApiRequestError. */
export async function expectOk(pending: Promise<ApiResponse<unknown>>): Promise<void> {
  const response = await pending;
  if (!response.ok) throw await failure(response);
}

async function failure(response: ApiResponse<unknown>): Promise<ApiRequestError> {
  if (response.status === 401) onUnauthorized();
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: ErrorCode; message?: string };
  } | null;
  return new ApiRequestError(
    response.status,
    body?.error?.code ?? 'INTERNAL',
    body?.error?.message ?? `Request failed (${response.status})`,
  );
}
