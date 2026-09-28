import { describe, expect, test } from 'vitest';
import { backdropColor, dominantColor, lightness } from './color';

type Rgba = [number, number, number, number];

function image(...regions: [count: number, pixel: Rgba][]): Uint8ClampedArray {
  const pixels = regions.flatMap(([count, pixel]) => Array.from({ length: count }, () => pixel));
  return new Uint8ClampedArray(pixels.flat());
}

describe('dominantColor', () => {
  test('finds a single flat colour', () => {
    expect(dominantColor(image([256, [200, 40, 40, 255]]))).toEqual([200, 40, 40]);
  });

  test('prefers the largest saturated area over greys, black and white', () => {
    const pixels = image(
      [90, [128, 128, 128, 255]],
      [60, [250, 250, 250, 255]],
      [50, [5, 5, 5, 255]],
      [56, [30, 90, 200, 255]],
    );
    expect(dominantColor(pixels)).toEqual([30, 90, 200]);
  });

  test('averages near-identical shades in one bucket', () => {
    const pixels = image([10, [200, 100, 20, 255]], [10, [204, 104, 24, 255]]);
    expect(dominantColor(pixels)).toEqual([202, 102, 22]);
  });

  test('uses the greys when that is all there is', () => {
    expect(dominantColor(image([64, [120, 120, 120, 255]]))).toEqual([120, 120, 120]);
  });

  test('ignores transparent pixels; a fully transparent image has no colour', () => {
    expect(dominantColor(image([64, [255, 0, 0, 0]]))).toBeNull();
  });
});

describe('backdropColor', () => {
  test('keeps backdrops dark enough for white text', () => {
    for (const rgb of [
      [255, 255, 255],
      [255, 230, 0],
      [30, 90, 200],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const l = lightness(backdropColor(rgb));
      expect(l).toBeGreaterThanOrEqual(0.12);
      expect(l).toBeLessThanOrEqual(0.3);
    }
  });

  test('keeps the hue', () => {
    const [r, g, b] = backdropColor([30, 90, 200]);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
