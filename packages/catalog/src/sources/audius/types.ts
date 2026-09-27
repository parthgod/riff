export interface AudiusArtwork {
  '150x150'?: string;
  '480x480'?: string;
  '1000x1000'?: string;
  mirrors?: string[];
}

export interface AudiusUser {
  id: string;
  name: string;
  handle: string;
  is_verified: boolean;
  bio?: string | null;
  follower_count?: number;
  track_count?: number;
  profile_picture?: AudiusArtwork | null;
  cover_photo?: { '640x'?: string; '2000x'?: string } | null;
}

export interface AudiusTrack {
  id: string;
  title: string;
  duration?: number | null;
  user: AudiusUser;
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  release_date?: string | null;
  play_count?: number;
  permalink?: string | null;
  artwork?: AudiusArtwork | null;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_delete?: boolean;
  /** Signed stream URL plus mirror hosts; regenerated on every response. */
  stream?: { url: string; mirrors?: string[] } | null;
}

export interface AudiusPlaylist {
  id: string;
  playlist_name: string;
  description?: string | null;
  is_album: boolean;
  track_count?: number;
  permalink?: string | null;
  artwork?: AudiusArtwork | null;
  user: AudiusUser;
  tracks?: AudiusTrack[] | null;
}
