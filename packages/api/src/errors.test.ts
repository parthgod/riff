import { CatalogError } from '@riff/catalog';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, test } from 'vitest';
import { ApiError, toApiError } from './errors';

describe('toApiError', () => {
  test.each([
    ['NOT_FOUND', 404],
    ['UPSTREAM_ERROR', 502],
    ['UPSTREAM_TIMEOUT', 504],
  ] as const)('maps CatalogError %s to %i', (code, status) => {
    const error = toApiError(new CatalogError(code, 'upstream said no'));
    expect(error).toMatchObject({ code, status, message: 'upstream said no' });
  });

  test('keeps ApiErrors as they are', () => {
    const original = new ApiError('FORBIDDEN', 'nope');
    expect(toApiError(original)).toBe(original);
  });

  test('maps Hono HTTP exceptions by status', () => {
    expect(toApiError(new HTTPException(400, { message: 'Malformed JSON' }))).toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
    expect(toApiError(new HTTPException(413))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(toApiError(new HTTPException(503))).toMatchObject({ code: 'INTERNAL', status: 500 });
  });

  test('hides the details of unexpected errors', () => {
    const error = toApiError(new Error('password=hunter2 in a stack trace'));
    expect(error).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(error.message).not.toContain('hunter2');
  });
});
