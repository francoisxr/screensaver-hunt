// The colours of cookies. A theme is one or two colours; each cookie slowly drifts between them
// (a different wave per cookie). Within a cookie the colour runs from a deep shade of it (the faint
// glow), through the pure colour, to a near-white hot edge (the ring). Going through the pure
// colour keeps it vivid instead of washing out.

import { parseColor, mixRgb } from '../core/color.mjs'
import { clamp01 } from '../core/math.mjs'

const PURE_AT = 0.6 // how far along the glow (0 faint .. 1 ring) the pure colour sits

/**
 * @param {typeof import('../config/defaults.mjs').DEFAULTS.look.cookies} look
 * @returns {(id: number, seconds: number) => (light: number) => number[]}
 *   for a cookie and a moment, a function from brightness (`light`, see cookie-shape.mjs) to [r, g, b]
 */
export function createCookieStyle (look) {
  const colors = (look.themes[look.theme] || look.themes.white).map(c => parseColor(c) || [255, 255, 255])
  const first = colors[0]
  const last = colors[colors.length - 1]
  const { minLight } = look.shape

  return (id, seconds) => {
    const base = mixRgb(first, last, 0.5 + 0.5 * Math.sin(seconds * 0.9 + id * 1.3))
    const deep = base.map(v => v * look.deep)
    const hot = base.map(v => v + (255 - v) * look.hot)
    return light => {
      const k = clamp01((light - minLight) / (1 - minLight))
      const mixed = k < PURE_AT ? mixRgb(deep, base, k / PURE_AT) : mixRgb(base, hot, (k - PURE_AT) / (1 - PURE_AT))
      return mixed.map(Math.round)
    }
  }
}
