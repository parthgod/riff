import { CollectionSchema, TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawJamendoAlbum, rawJamendoArtist, rawJamendoTrack } from './fixtures';
import { fromJamendoTag, mapAlbum, mapArtist, mapTrack, mapTracks, toJamendoTag } from './map';

describe('mapTrack', () => {
  test('maps every field, sizing artwork via the width parameter', () => {
    expect(mapTrack(rawJamendoTrack())).toEqual({
      id: 'jamendo:1886257',
      source: 'jamendo',
      title: 'Sunny Side',
      artists: [{ id: 'jamendo:7872', name: 'Ketsa' }],
      album: { id: 'jamendo:album:404149', title: 'Good Vibes' },
      durationSec: 187,
      isLive: false,
      artwork: {
        sm: 'https://usercontent.jamendo.com/?type=album&id=404149&width=200&trackid=1886257',
        md: 'https://usercontent.jamendo.com/?type=album&id=404149&width=500&trackid=1886257',
        lg: 'https://usercontent.jamendo.com/?type=album&id=404149&width=600&trackid=1886257',
      },
      genre: 'Electronic',
      releaseDate: '2021-05-14',
      permalink: 'https://www.jamendo.com/track/1886257',
    });
  });

  test('handles string and empty durations, missing images, albums and tags', () => {
    const t = mapTrack(
      rawJamendoTrack({
        duration: '',
        image: '',
        album_image: '',
        album_id: '0',
        musicinfo: undefined,
      }),
    );
    expect(TrackSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ durationSec: 0, artwork: {} });
    expect(t.album).toBeUndefined();
    expect(t.genre).toBeUndefined();
    expect(mapTrack(rawJamendoTrack({ duration: '201' })).durationSec).toBe(201);
  });

  test('mapTracks drops tracks without a streamable audio url', () => {
    expect(mapTracks([rawJamendoTrack(), rawJamendoTrack({ id: '2', audio: '' })])).toHaveLength(1);
  });
});

describe('mapArtist / mapAlbum', () => {
  test('maps an artist', () => {
    expect(mapArtist(rawJamendoArtist())).toMatchObject({
      id: 'jamendo:7872',
      source: 'jamendo',
      name: 'Ketsa',
      verified: false,
    });
  });

  test('maps an album with its streamable tracks credited to the album artist', () => {
    const album = mapAlbum(rawJamendoAlbum(), { withTracks: true });
    expect(CollectionSchema.safeParse(album).success).toBe(true);
    expect(album).toMatchObject({ id: 'jamendo:album:404149', kind: 'album', trackCount: 1 });
    expect(album.tracks?.[0]).toMatchObject({
      id: 'jamendo:1886257',
      artists: [{ id: 'jamendo:7872', name: 'Ketsa' }],
      album: { id: 'jamendo:album:404149', title: 'Good Vibes' },
      durationSec: 187,
    });
    expect(
      mapAlbum(rawJamendoAlbum({ tracks: undefined }), { withTracks: false }).trackCount,
    ).toBeUndefined();
  });
});

describe('genre tags', () => {
  test('translate between Audius genre names and Jamendo tags', () => {
    expect(toJamendoTag('Hip-Hop/Rap')).toBe('hiphop');
    expect(toJamendoTag('Drum & Bass')).toBe('drumnbass');
    expect(toJamendoTag('Deep House')).toBe('deephouse');
    expect(fromJamendoTag('hiphop')).toBe('Hip-Hop/Rap');
    expect(fromJamendoTag('lounge')).toBe('Lounge');
  });
});
