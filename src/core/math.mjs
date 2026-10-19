// Small numeric helpers shared by the physics and the renderer.

export const TAU = 2 * Math.PI

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

export const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)

export const lerp = (a, b, t) => a + (b - a) * t

/** Smootherstep: 0 at p <= 0, 1 at p >= 1, with zero slope at both ends. */
export function smootherstep (p) {
  p = clamp01(p)
  return p * p * p * (p * (p * 6 - 15) + 10)
}

/** Sum of an array of numbers. */
export const sum = values => values.reduce((a, b) => a + b, 0)
