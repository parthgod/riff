/** 0:07, 3:25, 1:02:09. Unknown or negative values show as 0:00. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds as number))
    : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 950, 1.2K, 3.4M. */
export const formatCount = (value: number): string => compact.format(value);

/** "Artist A, Artist B" (radio stations have no artists). */
export const artistNames = (artists: readonly { name: string }[]): string =>
  artists.map((artist) => artist.name).join(', ');
