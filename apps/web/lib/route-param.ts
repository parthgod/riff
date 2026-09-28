'use client';

import { useParams } from 'next/navigation';

/** Decodes a percent-encoded route segment; a malformed one (e.g. a stray `%`) is used as-is. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A dynamic route segment, decoded (`/genre/Hip-Hop%2FRap` gives `Hip-Hop/Rap`). */
export function useRouteParam(name: string): string {
  const value = useParams<Record<string, string>>()[name];
  return decodeSegment(typeof value === 'string' ? value : '');
}
