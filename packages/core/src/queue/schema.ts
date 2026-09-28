import { z } from 'zod';
import { TrackSchema } from '../types';
import { QUEUE_CONTEXT_TYPES, REPEAT_MODES } from './types';

const QueueItemSchema = z.object({ uid: z.string().min(1), track: TrackSchema });

/**
 * Validates a queue state read back from storage. Beyond the shape, it checks the invariants
 * the reducer relies on, so a corrupt or outdated save is rejected instead of half-restored.
 */
export const QueueStateSchema = z
  .object({
    context: z
      .object({ type: z.enum(QUEUE_CONTEXT_TYPES), id: z.string().optional(), name: z.string() })
      .nullable(),
    original: z.array(QueueItemSchema),
    order: z.array(QueueItemSchema),
    index: z.number().int().min(-1),
    upNext: z.array(QueueItemSchema),
    current: QueueItemSchema.nullable(),
    currentFromUpNext: z.boolean(),
    shuffle: z.boolean(),
    repeat: z.enum(REPEAT_MODES),
  })
  .refine((state) => state.index < state.order.length, 'index is past the end of order')
  .refine(
    (state) =>
      !state.current ||
      state.currentFromUpNext ||
      state.order[state.index]?.uid === state.current.uid,
    'current must be order[index] unless it came from upNext',
  );
