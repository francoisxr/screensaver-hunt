// What a cookie looks like: a tiny digital ring, after play.core's sdf/circle program
// (https://play.ertdfgcvb.xyz/#/src/sdf/circle). The distance to a circle drives a density ramp of
// characters (dense at the ring, fading away from it), every second column is a heavy vertical bar,
// and the radius breathes. It is 5 characters wide and 3 rows tall.
//
// This file only decides which characters and how bright; colours come from cookie-style.mjs and
// where the cookie is from the compositor.

export const WIDTH = 5
export const HEIGHT = 3

const BAR = '┃' // heavy vertical bar, for every second column

// Characters from dense to light (the circle program's set, ordered by weight).
const DENSITY = ['M', 'X', 'Z', 'Y', 'a', 'b', 'c', '/', '\\', '?', '!', '=', '-', '.']

/**
 * @typedef {object} CookieAnimation
 * @property {number} pulse    phase of the breathing, radians
 * @property {number} shimmer  phase of the flicker, radians
 * @property {number} fear     0..1: a frightened cookie breathes deeper and flickers harder
 * (The phases are advanced by the caller, so changing the speed never makes them jump.)
 */

/**
 * The cells of one cookie.
 * @param {number} id gives each cookie its own look
 * @param {CookieAnimation} state
 * @param {number} aspect character width / height
 * @param {typeof import('../config/defaults.mjs').DEFAULTS.look.cookies.shape} shape
 * @returns {{ dx: number, dy: number, char: string, light: number }[]}
 *   columns / rows from the cookie's top left; `light` runs from shape.minLight (faint) to 1 (the ring)
 */
export function cookieCells (id, state, aspect, shape) {
  const phase = id * 1.7
  const { pulse, shimmer, fear } = state
  const radius = shape.radius + shape.pulse * (1 + 0.8 * fear) * Math.cos(pulse + phase)
  const flicker = shape.shimmer * (1 + 2.5 * fear)
  const cells = []
  for (let j = 0; j < HEIGHT; j++) {
    for (let i = 0; i < WIDTH; i++) {
      const px = (i - (WIDTH - 1) / 2) * aspect
      const py = j - (HEIGHT - 1) / 2
      const d = Math.hypot(px, py) - radius
      let v = 1 - Math.exp(-(d < 0 ? shape.inner : shape.falloff) * Math.abs(d))
      v += flicker * Math.sin(shimmer + i * 2.1 + j * 3.7 + phase)
      v = Math.max(0, Math.min(0.999, v))
      if (v > shape.cutoff) continue
      const k = v / shape.cutoff
      const weighted = Math.pow(k, shape.weight)
      const char = i % 2 ? BAR : DENSITY[Math.min(DENSITY.length - 1, Math.floor(weighted * DENSITY.length))]
      cells.push({ dx: i, dy: j, char, light: 1 - (1 - shape.minLight) * weighted })
    }
  }
  return cells
}
