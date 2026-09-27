import type { JamendoAlbum, JamendoArtist, JamendoResponse, JamendoTrack } from './types';

export function rawJamendoTrack(overrides: Partial<JamendoTrack> = {}): JamendoTrack {
  return {
    id: '1886257',
    name: 'Sunny Side',
    duration: 187,
    artist_id: '7872',
    artist_name: 'Ketsa',
    album_id: '404149',
    album_name: 'Good Vibes',
    releasedate: '2021-05-14',
    image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600&trackid=1886257',
    album_image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32',
    shareurl: 'https://www.jamendo.com/track/1886257',
    musicinfo: { tags: { genres: ['electronic', 'lounge'] } },
    ...overrides,
  };
}

export function rawJamendoArtist(overrides: Partial<JamendoArtist> = {}): JamendoArtist {
  return {
    id: '7872',
    name: 'Ketsa',
    image: 'https://usercontent.jamendo.com?type=artist&id=7872&width=300',
    ...overrides,
  };
}

export function rawJamendoAlbum(overrides: Partial<JamendoAlbum> = {}): JamendoAlbum {
  return {
    id: '404149',
    name: 'Good Vibes',
    artist_id: '7872',
    artist_name: 'Ketsa',
    image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600',
    releasedate: '2021-05-14',
    tracks: [
      {
        id: '1886257',
        name: 'Sunny Side',
        duration: '187',
        audio: 'https://audio.test/1',
        position: '1',
      },
      { id: '1886258', name: 'No Stream', duration: '201', audio: '', position: '2' },
    ],
    ...overrides,
  };
}

export function jamendoOk<T>(results: T[]): JamendoResponse<T> {
  return {
    headers: { status: 'success', code: 0, error_message: '', results_count: results.length },
    results,
  };
}
