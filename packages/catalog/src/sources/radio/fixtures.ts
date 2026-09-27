import type { RadioStation } from './types';

export function rawStation(overrides: Partial<RadioStation> = {}): RadioStation {
  return {
    stationuuid: '9617a958-0601-11e8-ae97-52543be04c81',
    name: ' Lofi Girl Radio ',
    url_resolved: 'https://stream.lofi.test/live.mp3',
    homepage: 'https://lofi.test/',
    favicon: 'https://lofi.test/icon.png',
    tags: 'lofi,chillhop,study',
    country: 'France',
    countrycode: 'FR',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    ...overrides,
  };
}
