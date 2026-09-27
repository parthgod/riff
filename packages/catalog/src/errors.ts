export type CatalogErrorCode = 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT';

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  /** Upstream service involved, e.g. "audius" or "lrclib". */
  readonly upstream: string | undefined;

  constructor(
    code: CatalogErrorCode,
    message: string,
    options: { upstream?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'CatalogError';
    this.code = code;
    this.upstream = options.upstream;
  }
}

export function isCatalogError(error: unknown, code?: CatalogErrorCode): error is CatalogError {
  return error instanceof CatalogError && (code === undefined || error.code === code);
}
