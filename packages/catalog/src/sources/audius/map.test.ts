import { ArtistSchema, CollectionSchema, TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawPlaylist, rawTrack, rawUser } from './fixtures';
import { isPlayable, mapPlaylist, mapTrack, mapTracks, mapUser } from './map';

describe('mapTrack', () => {
  test('maps every field', () => {
    expect(mapTrack(rawTrack())).toEqual({
      id: 'audius:NQwXON0',
      source: 'audius',
      title: 'Rave! Code Radio 025',
      artists: [{ id: 'audius:k259kWP', name: 'Van Snyder' }],
      durationSec: 3573,
      isLive: false,
      artwork: {
        sm: 'https://cdn.test/art/150x150.jpg',
        md: 'https://cdn.test/art/480x480.jpg',
        lg: 'https://cdn.test/art/1000x1000.jpg',
      },
      genre: 'Electronic',
      mood: 'Fiery',
      bpm: 120,
      releaseDate: '2026-09-21T18:03:02.638196Z',
      playCount: 1183,
      permalink: 'https://audius.co/vansnydermusic/rave-code-radio-025',
    });
    expect(TrackSchema.safeParse(mapTrack(rawTrack())).success).toBe(true);
  });

  test('tolerates missing optional metadata', () => {
    const t = mapTrack(
      rawTrack({
        title: '   ',
        genre: '',
        mood: null,
        bpm: 0,
        release_date: null,
        artwork: null,
        permalink: null,
        duration: null,
      }),
    );
    expect(TrackSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ title: 'Untitled', durationSec: 0, artwork: {} });
    expect(t.genre).toBeUndefined();
    expect(t.bpm).toBeUndefined();
    expect(t.permalink).toBeUndefined();
  });
});

describe('isPlayable / mapTracks', () => {
  test('drops gated, deleted and unstreamable tracks', () => {
    expect(isPlayable(rawTrack())).toBe(true);
    expect(isPlayable(rawTrack({ is_stream_gated: true }))).toBe(false);
    expect(isPlayable(rawTrack({ is_delete: true }))).toBe(false);
    expect(isPlayable(rawTrack({ is_streamable: false }))).toBe(false);
    expect(mapTracks([rawTrack(), rawTrack({ id: 'x', is_delete: true })])).toHaveLength(1);
  });
});

describe('mapUser', () => {
  test('maps an artist and falls back to the smaller banner', () => {
    expect(mapUser(rawUser())).toEqual({
      id: 'audius:k259kWP',
      source: 'audius',
      name: 'Van Snyder',
      handle: 'vansnydermusic',
      avatar: {
        sm: 'https://cdn.test/pp/150x150.jpg',
        md: 'https://cdn.test/pp/480x480.jpg',
        lg: 'https://cdn.test/pp/1000x1000.jpg',
      },
      banner: 'https://cdn.test/cover/2000x.jpg',
      bio: 'Trance producer',
      followerCount: 5120,
      trackCount: 87,
      verified: true,
    });
    const small = mapUser(rawUser({ cover_photo: { '640x': 'https://cdn.test/c/640x.jpg' } }));
    expect(small.banner).toBe('https://cdn.test/c/640x.jpg');
    const bare = mapUser(rawUser({ profile_picture: null, cover_photo: null, bio: null }));
    expect(ArtistSchema.safeParse(bare).success).toBe(true);
    expect(bare.avatar).toEqual({});
  });
});

describe('mapPlaylist', () => {
  test('maps playlists and albums, with playable tracks only when asked', () => {
    const withTracks = mapPlaylist(rawPlaylist(), { withTracks: true });
    expect(withTracks.kind).toBe('playlist');
    expect(withTracks.owner).toEqual({ id: 'audius:bQ3Kk', name: 'KaRMaTRaiN379' });
    expect(withTracks.tracks?.map((t) => t.id)).toEqual(['audius:NQwXON0', 'audius:Abc123']);
    expect(CollectionSchema.safeParse(withTracks).success).toBe(true);

    const album = mapPlaylist(rawPlaylist({ is_album: true }), { withTracks: false });
    expect(album.kind).toBe('album');
    expect(album.tracks).toBeUndefined();
    expect(album.trackCount).toBe(3);
  });
});
