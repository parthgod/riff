'use client';

import { useEffect, useState } from 'react';
import { backdropColor, dominantColor, type Rgb } from './color';

const cache = new Map<string, Rgb | null>();
const SAMPLE = 16;

function sample(image: HTMLImageElement): Rgb | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  // Throws if the host didn't send CORS headers (a tainted canvas); callers get null.
  const color = dominantColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  return color && backdropColor(color);
}

/** A dark backdrop colour taken from the artwork at `src`, or null while loading or unknown. */
export function useDominantColor(src: string | undefined): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(() => (src ? (cache.get(src) ?? null) : null));
  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (cache.has(src)) {
      setColor(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      let result: Rgb | null = null;
      try {
        result = sample(image);
      } catch {
        result = null;
      }
      cache.set(src, result);
      if (!cancelled) setColor(result);
    };
    image.onerror = () => {
      cache.set(src, null);
      if (!cancelled) setColor(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return color;
}
