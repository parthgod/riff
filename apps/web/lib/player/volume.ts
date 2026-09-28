/** Slider position (0..1) to element volume: squaring matches how loudness is perceived. */
export const toGain = (slider: number): number => {
  const clamped = Math.min(Math.max(slider, 0), 1);
  return clamped * clamped;
};
