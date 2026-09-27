import { CACHE_TTL, type Catalog } from '@riff/catalog';
import { GENRES, TrendingWindowSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import { cacheFor, fanOutTtl } from '../cache-control';
import { ApiError, notFound } from '../errors';
import { limitParam, validate } from '../validation';

const queryText = z.string().trim().max(200);
const tag = z.string().trim().min(1).max(50);

export function catalogRoutes(catalog: Catalog) {
  return new Hono<AppEnv>()
    .get(
      '/search',
      validate('query', z.object({ q: queryText, limit: limitParam(50, 20) })),
      async (c) => {
        const { q, limit } = c.req.valid('query');
        const result = await catalog.search(q, { limit });
        cacheFor(c, fanOutTtl(result.sources, CACHE_TTL.search));
        return c.json(result);
      },
    )
    .get(
      '/trending',
      validate(
        'query',
        z.object({
          genre: tag.optional(),
          window: TrendingWindowSchema.default('week'),
          limit: limitParam(100, 30),
        }),
      ),
      async (c) => {
        const result = await catalog.trending(c.req.valid('query'));
        cacheFor(c, fanOutTtl(result.sources, CACHE_TTL.trending));
        return c.json({ tracks: result.tracks, sources: result.sources });
      },
    )
    .get('/genres', (c) => {
      cacheFor(c, CACHE_TTL.entity);
      return c.json(GENRES);
    })
    .get('/tracks/:id', async (c) => {
      const track = await catalog.getTrack(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(track);
    })
    .get('/tracks/:id/lyrics', async (c) => {
      const lyrics = await catalog.getLyrics(c.req.param('id'));
      if (!lyrics) throw notFound('No lyrics for this track');
      cacheFor(c, CACHE_TTL.lyricsFound);
      return c.json(lyrics);
    })
    .get(
      '/stream/:id',
      validate('query', z.object({ format: z.literal('json').optional() })),
      async (c) => {
        // Signed URLs expire, so stream responses stay no-store (the default).
        const stream = await catalog.resolveStream(c.req.param('id'));
        if (c.req.valid('query').format === 'json') return c.json(stream);
        return c.redirect(stream.url, 302);
      },
    )
    .get('/artists/:id', async (c) => {
      const artist = await catalog.getArtist(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(artist);
    })
    .get(
      '/artists/:id/tracks',
      validate('query', z.object({ limit: limitParam(50, 20) })),
      async (c) => {
        const tracks = await catalog.getArtistTracks(c.req.param('id'), c.req.valid('query'));
        cacheFor(c, CACHE_TTL.entity);
        return c.json(tracks);
      },
    )
    .get(
      '/artists/:id/related',
      validate('query', z.object({ limit: limitParam(50, 10) })),
      async (c) => {
        const artists = await catalog.getRelatedArtists(c.req.param('id'), c.req.valid('query'));
        cacheFor(c, CACHE_TTL.entity);
        return c.json(artists);
      },
    )
    .get('/collections/:id', async (c) => {
      const collection = await catalog.getCollection(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(collection);
    })
    .get(
      '/radio/top',
      validate('query', z.object({ tag: tag.optional(), limit: limitParam(100, 30) })),
      async (c) => {
        const stations = await catalog.radioTop(c.req.valid('query'));
        cacheFor(c, CACHE_TTL.trending);
        return c.json(stations);
      },
    )
    .get(
      '/radio/search',
      validate(
        'query',
        z.object({ q: queryText.optional(), tag: tag.optional(), limit: limitParam(100, 30) }),
      ),
      async (c) => {
        const { q, tag, limit } = c.req.valid('query');
        // A name search wins; a tag alone lists that tag's top stations.
        if (q) {
          const stations = await catalog.radioSearch(q, { limit });
          cacheFor(c, CACHE_TTL.search);
          return c.json(stations);
        }
        if (!tag) throw new ApiError('BAD_REQUEST', 'Pass q or tag');
        const stations = await catalog.radioTop({ tag, limit });
        cacheFor(c, CACHE_TTL.trending);
        return c.json(stations);
      },
    );
}
