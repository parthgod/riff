import { isCatalogError } from '@riff/catalog';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code];
  }
}

export const notFound = (message: string) => new ApiError('NOT_FOUND', message);

/** Maps anything thrown by a route (catalog, validation, Hono, bugs) to the API error contract. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isCatalogError(error)) return new ApiError(error.code, error.message);
  if (error instanceof HTTPException)
    return new ApiError(codeForStatus(error.status), error.message);
  return new ApiError('INTERNAL', 'Something went wrong');
}

export function errorBody(error: ApiError): ErrorBody {
  return { error: { code: error.code, message: error.message } };
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL';
}
