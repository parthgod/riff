import type { AudiusArtwork, AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

const art = (base: string): AudiusArtwork => ({
  '150x150': `${base}/150x150.jpg`,
  '480x480': `${base}/480x480.jpg`,
  '1000x1000': `${base}/1000x1000.jpg`,
});

export function rawUser(overrides: Partial<AudiusUser> = {}): AudiusUser {
  return {
    id: 'k259kWP',
    name: 'Van Snyder',
    handle: 'vansnydermusic',
    is_verified: true,
    bio: 'Trance producer',
    follower_count: 5120,
    track_count: 87,
    profile_picture: art('https://cdn.test/pp'),
    cover_photo: {
      '640x': 'https://cdn.test/cover/640x.jpg',
      '2000x': 'https://cdn.test/cover/2000x.jpg',
    },
    ...overrides,
  };
}

export function rawTrack(overrides: Partial<AudiusTrack> = {}): AudiusTrack {
  return {
    id: 'NQwXON0',
    title: 'Rave! Code Radio 025',
    duration: 3573,
    user: rawUser(),
    genre: 'Electronic',
    mood: 'Fiery',
    bpm: 120,
    release_date: '2026-09-21T18:03:02.638196Z',
    play_count: 1183,
    permalink: '/vansnydermusic/rave-code-radio-025',
    artwork: art('https://cdn.test/art'),
    is_streamable: true,
    is_stream_gated: false,
    is_delete: false,
    stream: {
      url: 'https://node-a.test/tracks/cidstream/baeaaa?signature=%7B%22a%22%3A1%7D',
      mirrors: ['https://node-b.test', 'https://node-c.test'],
    },
    ...overrides,
  };
}

export function rawPlaylist(overrides: Partial<AudiusPlaylist> = {}): AudiusPlaylist {
  return {
    id: 'xPjKvK9',
    playlist_name: 'Walk with me',
    description: 'A long walk',
    is_album: false,
    track_count: 3,
    permalink: '/lottaboom/playlist/walk-with-me',
    artwork: art('https://cdn.test/pl'),
    user: rawUser({ id: 'bQ3Kk', name: 'KaRMaTRaiN379', handle: 'karmatrain' }),
    tracks: [
      rawTrack(),
      rawTrack({ id: 'Abc123', title: 'Second' }),
      rawTrack({ id: 'Gated1', is_stream_gated: true }),
    ],
    ...overrides,
  };
}
