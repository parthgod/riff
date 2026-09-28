import { type StreamInfo, StreamInfoSchema } from '@riff/core';
import { api, expectOk, unwrap } from '@/lib/api';
import type { PlayRecord } from './play-tracker';

/** Resolves a track's playable URL and mirrors (signed URLs; never cached). */
export const resolveStream = (id: string): Promise<StreamInfo> =>
  // The route also redirects (without ?format=json), so its client type is a union; parse it.
  unwrap(api.stream[':id'].$get({ param: { id }, query: { format: 'json' } })).then((body) =>
    StreamInfoSchema.parse(body),
  );

export const recordPlay = (play: PlayRecord): Promise<void> =>
  expectOk(api.me.history.$post({ json: play }));
