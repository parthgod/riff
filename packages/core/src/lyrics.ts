import type { LyricLine } from './types';

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

/** Parses LRC text into time-sorted lines. Metadata tags and untimed lines are dropped. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIME_TAG)];
    if (stamps.length === 0) continue;
    const text = raw.replace(TIME_TAG, '').replace(WORD_TAG, '').trim();
    for (const [, minutes, seconds, fraction = '0'] of stamps) {
      const ms = Number(fraction.padEnd(3, '0'));
      lines.push({ timeMs: (Number(minutes) * 60 + Number(seconds)) * 1000 + ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the last line whose start is at or before `positionMs`; -1 if none. */
export function findActiveLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid] as LyricLine).timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
