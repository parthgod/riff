import type { StreamInfo, Track } from '@riff/core';

/** The parts of HTMLAudioElement the engine uses (a fake stands in for it in tests). */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type EngineStatus = 'loading' | 'playing' | 'paused';

export interface EngineEvents {
  onStatus(status: EngineStatus): void;
  onTime(positionSec: number): void;
  /** null for live streams (and before metadata). */
  onDuration(durationSec: number | null): void;
  onEnded(): void;
  /** Every mirror failed, and so did one fresh resolution. */
  onFailed(track: Track, error: unknown): void;
}

export type ResolveStream = (trackId: string) => Promise<StreamInfo>;

/** Signed URLs outlive this comfortably; older prefetches are resolved again. */
export const PREFETCH_TTL_MS = 5 * 60_000;

/**
 * A source that accepts the connection but sends no audio for this long is treated as failed
 * (browsers report no error for a stalled mirror; they just wait).
 */
export const STALL_TIMEOUT_MS = 15_000;

interface LoadOptions {
  autoplay: boolean;
  /** Where to start, in seconds (ignored for live streams). */
  startAt?: number;
}

/**
 * Owns one media element: resolves streams, fails over across mirrors, re-resolves once when
 * every mirror fails (expired signatures), and prefetches the next track's stream. It knows
 * nothing about queues; the player store decides what to load.
 */
export class AudioEngine {
  private track: Track | null = null;
  private sources: string[] = [];
  private sourceIndex = 0;
  private reResolved = false;
  /** Increments per load, so a slow resolution for an old track is ignored. */
  private generation = 0;
  /** Position to restore after the next `loadedmetadata`. */
  private resumeAt = 0;
  /** Last position reported by the element; survives the element resetting on error. */
  private position = 0;
  private wantsPlay = false;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly prefetched = new Map<string, { info: StreamInfo; at: number }>();
  private readonly listeners: [string, () => void][];

  constructor(
    private readonly media: MediaElementLike,
    private readonly resolve: ResolveStream,
    private readonly events: EngineEvents,
  ) {
    media.preload = 'auto';
    this.listeners = [
      ['loadedmetadata', this.handleMetadata],
      ['playing', this.handlePlaying],
      ['waiting', this.handleWaiting],
      ['pause', this.handlePause],
      ['timeupdate', this.handleTime],
      ['durationchange', this.handleDuration],
      ['ended', this.handleEnded],
      ['error', this.handleError],
    ];
    for (const [type, listener] of this.listeners) media.addEventListener(type, listener);
  }

  /** Id of the track whose audio is loaded (or loading), if any. */
  get loadedTrackId(): string | null {
    return this.track?.id ?? null;
  }

  async load(track: Track, { autoplay, startAt = 0 }: LoadOptions): Promise<void> {
    const generation = ++this.generation;
    this.track = track;
    this.reResolved = false;
    this.wantsPlay = autoplay;
    this.resumeAt = track.isLive ? 0 : startAt;
    this.position = this.resumeAt;
    this.events.onStatus('loading');
    let info: StreamInfo;
    try {
      info = this.takePrefetched(track.id) ?? (await this.resolve(track.id));
    } catch (error) {
      if (generation === this.generation) this.events.onFailed(track, error);
      return;
    }
    if (generation !== this.generation) return;
    this.useStream(info);
  }

  async play(): Promise<void> {
    this.wantsPlay = true;
    this.armWatchdog();
    await this.media.play().catch(this.handlePlayRejection);
  }

  pause(): void {
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.media.pause();
  }

  seek(positionSec: number): void {
    if (!this.track || this.track.isLive) return;
    this.media.currentTime = positionSec;
    this.position = positionSec;
  }

  setVolume(gain: number): void {
    this.media.volume = gain;
  }

  setMuted(muted: boolean): void {
    this.media.muted = muted;
  }

  /** Resolves `track`'s stream ahead of time; the next `load` of it skips the round trip. */
  async prefetch(track: Track): Promise<void> {
    // Radio Browser counts a resolution as a listen, so stations resolve only on play.
    if (track.isLive || this.prefetched.has(track.id)) return;
    try {
      const info = await this.resolve(track.id);
      this.prefetched.clear();
      this.prefetched.set(track.id, { info, at: Date.now() });
    } catch {
      // Prefetching is an optimisation; the real load will resolve (and report) again.
    }
  }

  /** Stops playback and releases the network connection. */
  unload(): void {
    this.generation++;
    this.track = null;
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.media.pause();
    this.media.removeAttribute('src');
    this.media.load();
  }

  destroy(): void {
    this.unload();
    for (const [type, listener] of this.listeners) this.media.removeEventListener(type, listener);
  }

  private takePrefetched(trackId: string): StreamInfo | null {
    const entry = this.prefetched.get(trackId);
    this.prefetched.delete(trackId);
    if (!entry || Date.now() - entry.at > PREFETCH_TTL_MS) return null;
    return entry.info;
  }

  private useStream(info: StreamInfo): void {
    this.sources = [info.url, ...info.mirrors];
    this.sourceIndex = 0;
    this.setSource();
  }

  private setSource(): void {
    this.media.src = this.sources[this.sourceIndex] as string;
    if (!this.wantsPlay) return;
    this.armWatchdog();
    void this.media.play().catch(this.handlePlayRejection);
  }

  /** Until audio flows, a silent source is treated like one that errored. */
  private armWatchdog(): void {
    this.disarmWatchdog();
    if (this.wantsPlay) this.stallTimer = setTimeout(this.handleError, STALL_TIMEOUT_MS);
  }

  private disarmWatchdog(): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }

  private readonly handlePlayRejection = (error: unknown) => {
    // AbortError: the source changed before playback started; the new source plays instead.
    // NotSupportedError also arrives as an `error` event, which drives the failover.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      this.wantsPlay = false;
      this.disarmWatchdog();
      this.events.onStatus('paused');
    }
  };

  private readonly handleMetadata = () => {
    if (this.resumeAt > 0) this.media.currentTime = this.resumeAt;
    this.resumeAt = 0;
  };

  private readonly handlePlaying = () => {
    this.disarmWatchdog();
    // Audio is flowing again, so a later expiry (e.g. on a seek) earns a fresh resolution.
    this.reResolved = false;
    this.events.onStatus('playing');
  };

  private readonly handleWaiting = () => {
    if (!this.wantsPlay) return;
    this.armWatchdog();
    this.events.onStatus('loading');
  };

  private readonly handlePause = () => {
    // The element also fires `pause` when a track ends; `ended` handles that case.
    if (this.media.ended) return;
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.events.onStatus('paused');
  };

  private readonly handleTime = () => {
    this.position = this.media.currentTime;
    this.events.onTime(this.position);
  };

  private readonly handleDuration = () => {
    const { duration } = this.media;
    this.events.onDuration(Number.isFinite(duration) ? duration : null);
  };

  private readonly handleEnded = () => {
    this.events.onEnded();
  };

  private readonly handleError = () => {
    this.disarmWatchdog();
    const track = this.track;
    if (!track || this.sources.length === 0) return;
    this.resumeAt = track.isLive ? 0 : this.position;
    if (this.sourceIndex + 1 < this.sources.length) {
      this.sourceIndex++;
      this.setSource();
      return;
    }
    if (this.reResolved) {
      this.events.onFailed(track, new Error('Every stream source failed'));
      return;
    }
    this.reResolved = true;
    void this.reResolve(track);
  };

  private async reResolve(track: Track): Promise<void> {
    const generation = this.generation;
    const resumeAt = this.resumeAt;
    let info: StreamInfo;
    try {
      info = await this.resolve(track.id);
    } catch (error) {
      if (generation === this.generation) this.events.onFailed(track, error);
      return;
    }
    if (generation !== this.generation) return;
    this.resumeAt = resumeAt;
    this.useStream(info);
  }
}
