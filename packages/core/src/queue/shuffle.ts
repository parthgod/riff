/** Fisher–Yates shuffle into a new array. `rng` must return a float in [0, 1). */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const held = result[i] as T;
    result[i] = result[j] as T;
    result[j] = held;
  }
  return result;
}
