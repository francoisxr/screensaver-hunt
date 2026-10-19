// Circle geometry for the merge and split animations. Areas are measured in "masses": a hunter of
// mass m is a circle of radius r0 * sqrt(m), so its area is m * (pi * r0^2).

/**
 * Area of the overlap of two circles, divided by pi.
 * @param {number} r1 radius of the first circle
 * @param {number} r2 radius of the second circle
 * @param {number} d distance between the centres
 */
export function lensOverPi (r1, r2, d) {
  if (d >= r1 + r2) return 0
  if (d <= Math.abs(r1 - r2)) return Math.min(r1, r2) ** 2
  const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
  const tri = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)))
  return (r1 * r1 * a1 + r2 * r2 * a2 - tri) / Math.PI
}

/**
 * The mass a hunter must be drawn at so that, together with a second hunter drawn at mass `other`
 * and centred `dist` units away, the two cover `target` mass of area (found by bisection; the covered
 * area grows with the mass, so there is exactly one answer).
 * @param {number} target area to cover, in masses
 * @param {number} other mass of the second hunter
 * @param {number} dist distance between the two centres, in units
 * @param {number} r0 radius of a hunter of mass 1, in units
 */
export function solveDrawnMass (target, other, dist, r0) {
  const d = dist / r0
  let lo = 0
  let hi = Math.max(target, other) + 1
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    const union = k + other - lensOverPi(Math.sqrt(k), Math.sqrt(other), d)
    if (union < target) lo = k
    else hi = k
  }
  return (lo + hi) / 2
}

/**
 * Area covered by the union of some circles, in masses, sampled on a fixed grid (so the result stays
 * steady as the circles move).
 * @param {{x: number, y: number, r: number}[]} circles
 * @param {number} r0 radius of a hunter of mass 1, in units
 */
export function unionMass (circles, r0) {
  const step = r0 / 10
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r)
    y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r)
  }
  let n = 0
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      for (const c of circles) {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) { n++; break }
      }
    }
  }
  return n * step * step / (Math.PI * r0 * r0)
}
