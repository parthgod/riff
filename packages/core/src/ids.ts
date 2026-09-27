export const SOURCE_IDS = ['audius', 'jamendo', 'radio'] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

/** A source-namespaced id such as `audius:NQwXON0`. User playlists use UUIDs instead. */
export type EntityId = `${SourceId}:${string}`;

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export function makeEntityId(source: SourceId, nativeId: string | number): EntityId {
  const id = String(nativeId);
  if (id.length === 0) throw new Error(`Empty native id for source "${source}"`);
  return `${source}:${id}`;
}

export function parseEntityId(value: string): { source: SourceId; nativeId: string } | null {
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const source = value.slice(0, colon);
  const nativeId = value.slice(colon + 1);
  if (nativeId.length === 0 || !isSourceId(source)) return null;
  return { source, nativeId };
}

export function isEntityId(value: string): value is EntityId {
  return parseEntityId(value) !== null;
}
