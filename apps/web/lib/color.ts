export type Rgb = [number, number, number];

/** Quantisation step: 4 bits per channel, so near-identical shades share a bucket. */
const STEP = 16;

const isNeutral = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 28 || min > 235 || max - min < 24;
};

/**
 * The most common colour in RGBA pixel data (a small downscaled image). Saturated colours
 * beat greys, black and white, which only win when there is nothing else. Returns the average
 * of the winning bucket, or null for a fully transparent image.
 */
export function dominantColor(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number; neutral: boolean }
  >();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    if ((data[i + 3] as number) < 128) continue;
    const key = ((r / STEP) << 8) | ((g / STEP) << 4) | (b / STEP);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, neutral: isNeutral(r, g, b) };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number; neutral: boolean } | null = null;
  for (const bucket of buckets.values()) {
    if (
      !best ||
      (best.neutral && !bucket.neutral) ||
      (best.neutral === bucket.neutral && bucket.count > best.count)
    ) {
      best = bucket;
    }
  }
  if (!best) return null;
  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) =>
    Math.round(v * 255),
  ) as Rgb;
}

/** HSL lightness in [0, 1]. */
export const lightness = (rgb: Rgb): number => toHsl(rgb)[2];

/** The colour dimmed and tamed into a backdrop that white text stays readable on. */
export function backdropColor(rgb: Rgb): Rgb {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([h, Math.min(s, 0.55), Math.min(Math.max(l * 0.45, 0.14), 0.28)]);
}
