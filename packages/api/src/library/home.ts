import { DEFAULT_HOME_GENRES, type Track } from '@riff/core';
import { type Db, likedTracks, playHistory, tracks } from '@riff/db';
import { sql } from 'drizzle-orm';
import { type AppDeps, reportError } from '../deps';
import { listFollowing } from './following';
import { recentTracks } from './history';

export const HOME_LIMITS = {
  recentlyPlayed: 12,
  genres: 3,
  /** History rows considered when ranking genres (likes are always all counted). */
  genreHistoryWindow: 200,
  tracksPerGenre: 12,
  followedArtists: 10,
  tracksPerArtist: 5,
  fromFollowed: 20,
  trending: 20,
} as const;

export interface Home {
  recentlyPlayed: Track[];
  topGenres: { genre: string; tracks: Track[] }[];
  fromFollowed: Track[];
  trending: Track[];
}

type HomeDeps = Pick<AppDeps, 'db' | 'catalog' | 'onError'>;

/** Builds the four sections in parallel; a section that fails is returned empty. */
export async function composeHome(deps: HomeDeps, userId: string): Promise<Home> {
  const section = async <T>(name: string, fallback: T, load: () => Promise<T>): Promise<T> => {
    try {
      return await load();
    } catch (error) {
      reportError(deps, error, `home.${name}`);
      return fallback;
    }
  };

  const [recentlyPlayed, topGenres, fromFollowed, trending] = await Promise.all([
    section('recentlyPlayed', [], () => recentTracks(deps.db, userId, HOME_LIMITS.recentlyPlayed)),
    section('topGenres', [], () => genreShelves(deps, userId)),
    section('fromFollowed', [], () => newFromFollowed(deps, userId)),
    section('trending', [], async () => {
      const result = await deps.catalog.trending({ limit: HOME_LIMITS.trending });
      return result.tracks;
    }),
  ]);
  return { recentlyPlayed, topGenres, fromFollowed, trending };
}

/**
 * The user's most frequent genres over their last 200 plays plus all likes, topped up with the
 * default genres when there are fewer than three.
 */
async function topGenres(db: Db, userId: string): Promise<string[]> {
  const rows = await db.execute<{ genre: string }>(sql`
    with pool as (
      (select ${playHistory.trackId} as track_id from ${playHistory}
        where ${playHistory.userId} = ${userId}
        order by ${playHistory.playedAt} desc
        limit ${HOME_LIMITS.genreHistoryWindow})
      union all
      (select ${likedTracks.trackId} from ${likedTracks} where ${likedTracks.userId} = ${userId})
    )
    select ${tracks.data}->>'genre' as genre
    from pool join ${tracks} on ${tracks.id} = pool.track_id
    where coalesce(${tracks.data}->>'genre', '') <> ''
    group by 1
    order by count(*) desc, 1
    limit ${HOME_LIMITS.genres}
  `);
  const genres = rows.map((row) => row.genre);
  for (const genre of DEFAULT_HOME_GENRES) {
    if (genres.length >= HOME_LIMITS.genres) break;
    if (!genres.includes(genre)) genres.push(genre);
  }
  return genres;
}

async function genreShelves(deps: HomeDeps, userId: string): Promise<Home['topGenres']> {
  const genres = await topGenres(deps.db, userId);
  const shelves = await Promise.all(
    genres.map(async (genre) => {
      const { tracks } = await deps.catalog.trending({ genre, limit: HOME_LIMITS.tracksPerGenre });
      return { genre, tracks };
    }),
  );
  return shelves.filter((shelf) => shelf.tracks.length > 0);
}

/** Newest tracks across the ten most recently followed artists. */
async function newFromFollowed(deps: HomeDeps, userId: string): Promise<Track[]> {
  const artists = await listFollowing(deps.db, userId, HOME_LIMITS.followedArtists);
  const lists = await Promise.allSettled(
    artists.map((artist) =>
      deps.catalog.getArtistTracks(artist.id, {
        limit: HOME_LIMITS.tracksPerArtist,
        sort: 'newest',
      }),
    ),
  );
  const seen = new Set<string>();
  const merged: Track[] = [];
  for (const list of lists) {
    if (list.status === 'rejected') {
      reportError(deps, list.reason, 'home.fromFollowed');
      continue;
    }
    for (const track of list.value) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
  }
  // `merged` is our own array; the tracks inside are shared cache objects and stay untouched.
  return merged
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .slice(0, HOME_LIMITS.fromFollowed);
}
