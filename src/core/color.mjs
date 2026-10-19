// CSS-style colours (what play.core programs use) to [r, g, b] triples, and a little colour maths.

const NAMED = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  lime: [0, 255, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
}

const cache = new Map()

/**
 * Parses '#rrggbb', '#rgb', 'rgb(r, g, b)' / 'rgba(...)' and a few colour names.
 * @param {unknown} css
 * @returns {number[] | null} [r, g, b] (0..255), or null when it is not a colour we understand
 */
export function parseColor (css) {
  if (cache.has(css)) return cache.get(css)
  let out = null
  if (typeof css === 'string') {
    const s = css.trim().toLowerCase()
    let m
    if (NAMED[s]) out = NAMED[s]
    else if ((m = /^#([0-9a-f]{6})$/.exec(s))) out = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
    else if ((m = /^#([0-9a-f]{3})$/.exec(s))) out = [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16))
    else if ((m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s))) out = [+m[1], +m[2], +m[3]]
  }
  cache.set(css, out)
  return out
}

/** Linear mix of two [r, g, b] triples: t = 0 gives a, t = 1 gives b. */
export const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
