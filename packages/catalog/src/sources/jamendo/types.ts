export interface JamendoResponse<T> {
  headers: {
    status: 'success' | 'failed';
    code: number;
    error_message: string;
    results_count: number;
  };
  results: T[];
}

export interface JamendoTrack {
  id: string;
  name: string;
  /** Seconds; sometimes serialised as a string. */
  duration: number | string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  releasedate: string;
  image: string;
  album_image?: string;
  /** Streamable MP3 URL; empty when streaming is not allowed. */
  audio: string;
  shareurl?: string;
  musicinfo?: { tags?: { genres?: string[] } };
}

export interface JamendoArtist {
  id: string;
  name: string;
  image: string;
  shareurl?: string;
}

export interface JamendoAlbumTrack {
  id: string;
  name: string;
  duration: number | string;
  audio: string;
  position?: string;
}

export interface JamendoAlbum {
  id: string;
  name: string;
  artist_id: string;
  artist_name: string;
  image: string;
  releasedate: string;
  tracks?: JamendoAlbumTrack[];
}
