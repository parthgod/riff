import { makeEntityId, type Track } from '@riff/core';
import type { RadioStation } from './types';

/** Browsers block http media on https pages, and HLS playlists need extra tooling. */
export function isPlayableStreamUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://') && !/\.m3u8(?:[?#]|$)/i.test(url);
}

export function isUsableStation(station: RadioStation): boolean {
  return (
    station.lastcheckok === 1 && station.hls === 0 && isPlayableStreamUrl(station.url_resolved)
  );
}

function firstTag(tags: string | null | undefined): string | undefined {
  const tag = tags
    ?.split(',')
    .map((t) => t.trim())
    .find(Boolean);
  return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : undefined;
}

export function mapStation(station: RadioStation): Track {
  const icon = station.favicon?.startsWith('https://') ? station.favicon : undefined;
  return {
    id: makeEntityId('radio', station.stationuuid),
    source: 'radio',
    title: station.name.trim() || 'Untitled station',
    artists: [],
    durationSec: null,
    isLive: true,
    artwork: icon ? { sm: icon, md: icon, lg: icon } : {},
    genre: firstTag(station.tags),
    permalink: station.homepage || undefined,
  };
}
