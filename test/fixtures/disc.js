// A tiny play.core program for the tests: a filled disc of 'o' in the middle of its window.
export const settings = { fps: 30 }

export function main (coord, context) {
  const x = (coord.x - context.cols / 2) * context.metrics.aspect
  const y = coord.y - context.rows / 2
  return Math.hypot(x, y) < context.rows * 0.455 ? 'o' : ' '
}
