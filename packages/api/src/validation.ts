import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { ApiError } from './errors';

/** zValidator that reports failures through the API error contract (400 BAD_REQUEST). */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new ApiError('BAD_REQUEST', describeIssue(result.error.issues[0]));
  });

function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** A `?limit=` query parameter: an integer in [1, max], defaulting to `fallback`. */
export const limitParam = (max: number, fallback: number) =>
  z.coerce.number<string>().int().min(1).max(max).default(fallback);
