import { toast } from 'sonner';
import { useStore } from 'zustand';
import { AudioEngine } from './engine';
import { createPlayer, type PlayerState } from './player';
import { recordPlay, resolveStream } from './remote';

/** The one audio element, kept in the document so devtools and the smoke test can find it. */
function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.id = 'riff-audio';
  audio.hidden = true;
  document.body.append(audio);
  return audio;
}

/**
 * The app's one player. It lives outside React so playback survives navigation; its audio
 * element is created on the first action, which only ever happens in the browser.
 */
export const player = createPlayer({
  createEngine: (events) => new AudioEngine(createAudioElement(), resolveStream, events),
  env: { rng: Math.random, uid: () => crypto.randomUUID() },
  recordPlay,
  notify: (message) => toast(message),
});

/** Subscribes a component to part of the player state. Wrap object results in `useShallow`. */
export function usePlayer<T>(selector: (state: PlayerState) => T): T {
  return useStore(player.store, selector);
}
