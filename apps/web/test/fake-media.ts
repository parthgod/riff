import type { MediaElementLike } from '@/lib/player/engine';

type Listener = () => void;

/**
 * A scriptable stand-in for HTMLAudioElement. Tests drive it with `emit()` and inspect the
 * sources it was given in `srcHistory`.
 */
export class FakeMedia implements MediaElementLike {
  currentTime = 0;
  duration = Number.NaN;
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  preload = '';
  srcHistory: string[] = [];
  /** What the next play() call does; defaults to starting playback. */
  playResult: () => Promise<void> = async () => {
    this.paused = false;
  };
  private readonly listeners = new Map<string, Set<Listener>>();

  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    this.srcHistory.push(value);
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.currentSrc = '';
  }

  load(): void {}

  play(): Promise<void> {
    return this.playResult();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}
