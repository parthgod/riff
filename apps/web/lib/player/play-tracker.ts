import type { EntityId } from '@riff/core';

export interface PlayRecord {
  trackId: EntityId;
  msPlayed: number;
  context?: string;
}

export type RecordPlay = (play: PlayRecord) => Promise<void>;

/** A play counts once this much has been heard (or at the end of a shorter track). */
export const COUNT_AFTER_MS = 30_000;
/** Position jumps larger than this between timeupdates are seeks, not listening. */
const MAX_STEP_SEC = 2;

/**
 * Accumulates audible listening time for the current play and records the play once:
 * at 30 s, or when a shorter track ends.
 */
export class PlayTracker {
  private trackId: EntityId | null = null;
  private context: string | undefined;
  private heardMs = 0;
  private lastPosition: number | null = null;
  private recorded = false;

  constructor(private readonly record: RecordPlay) {}

  start(trackId: EntityId, context?: string): void {
    this.trackId = trackId;
    this.context = context;
    this.heardMs = 0;
    this.lastPosition = null;
    this.recorded = false;
  }

  onTime(positionSec: number, audible: boolean): void {
    const step = this.lastPosition === null ? 0 : positionSec - this.lastPosition;
    this.lastPosition = positionSec;
    if (!audible || step <= 0 || step > MAX_STEP_SEC) return;
    this.heardMs += step * 1000;
    if (this.heardMs >= COUNT_AFTER_MS) this.flush();
  }

  onSeek(positionSec: number): void {
    this.lastPosition = positionSec;
  }

  onEnded(): void {
    if (this.heardMs > 0) this.flush();
  }

  private flush(): void {
    if (this.recorded || !this.trackId) return;
    this.recorded = true;
    const play: PlayRecord = { trackId: this.trackId, msPlayed: Math.round(this.heardMs) };
    if (this.context) play.context = this.context;
    this.record(play).catch(() => {
      // History is best-effort; a lost play only affects Home's "recently played".
    });
  }
}
