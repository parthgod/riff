/** Anything with zod's `safeParse`, such as the schemas exported by `@riff/core`. */
interface Validator {
  safeParse(value: unknown): { success: boolean };
}

/**
 * Maps one upstream item, returning null when mapping throws or the result fails
 * validation, so a single malformed item never fails a whole request.
 */
export function mapOneValid<R, T>(item: R, map: (item: R) => T, schema: Validator): T | null {
  try {
    const mapped = map(item);
    return schema.safeParse(mapped).success ? mapped : null;
  } catch {
    return null;
  }
}

/** Maps upstream items, dropping any that cannot be mapped to a valid entity. */
export function mapValid<R, T>(items: readonly R[], map: (item: R) => T, schema: Validator): T[] {
  const result: T[] = [];
  for (const item of items) {
    const mapped = mapOneValid(item, map, schema);
    if (mapped !== null) result.push(mapped);
  }
  return result;
}
