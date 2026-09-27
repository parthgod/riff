import {
  type Artist,
  type Artwork,
  type Collection,
  makeEntityId,
  type Track,
  TrackSchema,
} from '@riff/core';
import { mapValid } from '../../map-valid';
import type { AudiusArtwork, AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

const AUDIUS_WEB = 'https://audius.co';

export function mapArtwork(art: AudiusArtwork | null | undefined): Artwork {
  return {
    sm: art?.['150x150'] || undefined,
    md: art?.['480x480'] || undefined,
    lg: art?.['1000x1000'] || undefined,
  };
}

export function isPlayable(track: AudiusTrack): boolean {
  return track.is_streamable !== false && !track.is_stream_gated && !track.is_delete;
}

export function mapTrack(track: AudiusTrack): Track {
  return {
    id: makeEntityId('audius', track.id),
    source: 'audius',
    title: track.title.trim() || 'Untitled',
    artists: [{ id: makeEntityId('audius', track.user.id), name: track.user.name }],
    durationSec: Math.max(0, track.duration ?? 0),
    isLive: false,
    artwork: mapArtwork(track.artwork),
    genre: track.genre || undefined,
    mood: track.mood || undefined,
    bpm: track.bpm && track.bpm > 0 ? track.bpm : undefined,
    releaseDate: track.release_date || undefined,
    playCount: track.play_count ?? undefined,
    permalink: track.permalink ? `${AUDIUS_WEB}${track.permalink}` : undefined,
  };
}

export const mapTracks = (tracks: readonly AudiusTrack[]): Track[] =>
  mapValid(tracks.filter(isPlayable), mapTrack, TrackSchema);

export function mapUser(user: AudiusUser): Artist {
  return {
    id: makeEntityId('audius', user.id),
    source: 'audius',
    name: user.name,
    handle: user.handle || undefined,
    avatar: mapArtwork(user.profile_picture),
    banner: user.cover_photo?.['2000x'] || user.cover_photo?.['640x'] || undefined,
    bio: user.bio || undefined,
    followerCount: user.follower_count ?? undefined,
    trackCount: user.track_count ?? undefined,
    verified: Boolean(user.is_verified),
  };
}

export function mapPlaylist(
  playlist: AudiusPlaylist,
  { withTracks }: { withTracks: boolean },
): Collection {
  return {
    id: makeEntityId('audius', playlist.id),
    source: 'audius',
    kind: playlist.is_album ? 'album' : 'playlist',
    title: playlist.playlist_name,
    description: playlist.description || undefined,
    artwork: mapArtwork(playlist.artwork),
    owner: { id: makeEntityId('audius', playlist.user.id), name: playlist.user.name },
    trackCount: playlist.track_count ?? undefined,
    tracks: withTracks ? mapTracks(playlist.tracks ?? []) : undefined,
  };
}
