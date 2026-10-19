// A tiny play.core program to try things with, written for this project. Run it with
//   play-term examples/pulse.js
// or put a copy next to your own experiments. (play.core programs export boot / pre / main / post /
// settings; see https://play.ertdfgcvb.xyz.)

export const settings = { fps: 30 }

const SHADES = ' .:-=+*#%@'

export function main (coord, context) {
  // The middle of the window, with x scaled by the cell shape so the ring is round.
  const x = (coord.x - context.cols / 2) * context.metrics.aspect
  const y = coord.y - context.rows / 2
  const radius = Math.min(context.cols * context.metrics.aspect, context.rows) * (0.3 + 0.1 * Math.sin(context.time * 0.002))
  const distance = Math.abs(Math.hypot(x, y) - radius)
  const brightness = Math.exp(-distance * 1.2)
  return SHADES[Math.min(SHADES.length - 1, Math.floor(brightness * SHADES.length))]
}
