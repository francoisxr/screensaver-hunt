// An organic edge for the hunters. The dish itself comes from the unmodified play.core program,
// which always draws a rigid circle; this warps how it is shown.
//
// Every hunter has a body shape of its own, drawn at random from its id: a blend of the first few
// harmonics around the circle (lumps, dents, a lopsided lean) with random sizes, phases and drift
// speeds, so no two hunters look alike and none looks geometric. The lumps slowly migrate and swell,
// which makes the body crawl like a blob. For every direction around the centre there is a stretch
// factor w; a screen cell shows the dish cell that lies (1 + w) times closer to the centre. On top of
// that, a fast hunter stretches along its direction of travel, like a lunge.

import { Rng, mulberry32 } from '../core/rng.mjs'

export const BINS = 96 // directions around the hunter
const HARMONICS = 7

const shapes = new Map() // hunter id -> its random harmonics

/** The random body of a hunter: for each harmonic, a size, a phase and a drift speed. */
function shapeOf (id) {
  let shape = shapes.get(id)
  if (shape) return shape
  const rng = new Rng(mulberry32(id * 7919 + 17))
  const harmonics = []
  let total = 0
  for (let k = 1; k <= HARMONICS; k++) {
    const size = rng.float(0.2, 1) / Math.pow(k, 0.6) * (k === 1 ? 0.5 : 1) // low harmonics are bigger; the lean (k = 1) is kept mild
    harmonics.push({ k, size, phase: rng.float(0, 2 * Math.PI), drift: rng.float(0.25, 1.1) * rng.sign() / Math.sqrt(k), swell: rng.float(0.1, 0.4), swellPhase: rng.float(0, 2 * Math.PI) })
    total += size * (1 + 0.5) // size at its largest swell
  }
  shape = { harmonics, total }
  shapes.set(id, shape)
  return shape
}

/**
 * Fills `table` (BINS values, one per direction) with the stretch factor for hunter `id` at time
 * `t` seconds. |w| never exceeds `amp`.
 * @param {number} id
 * @param {number} t
 * @param {number} amp
 * @param {Float32Array} [table] reused if given, to avoid allocating every frame
 */
export function wobbleTable (id, t, amp, table = new Float32Array(BINS)) {
  const { harmonics, total } = shapeOf(id)
  for (let k = 0; k < BINS; k++) {
    const a = (k + 0.5) / BINS * 2 * Math.PI
    let v = 0
    for (const h of harmonics) v += h.size * (1 + 0.5 * Math.sin(h.swell * t + h.swellPhase)) * Math.sin(h.k * a + h.drift * t + h.phase)
    table[k] = amp * 1.9 * v / total // the harmonics rarely line up, so the scale is above 1; clamped below
    if (table[k] > amp) table[k] = amp
    else if (table[k] < -amp) table[k] = -amp
  }
  return table
}

/** Which direction bin a point (x, y), relative to the centre, falls in. */
export function binOf (x, y) {
  const k = Math.floor((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * BINS)
  return k < 0 ? 0 : k >= BINS ? BINS - 1 : k
}

/**
 * A hunter moving fast stretches along its direction of travel (the unit vector ux, uy) by the factor
 * S and narrows across it, keeping its area. Given a point (qx, qy) of the stretched hunter, this
 * returns the point of the round hunter to show there.
 * @returns {[number, number]}
 */
export function unstretch (qx, qy, ux, uy, S) {
  const along = qx * ux + qy * uy
  const across = -qx * uy + qy * ux
  const a = along / S
  const c = across * Math.sqrt(S)
  return [a * ux - c * uy, a * uy + c * ux]
}
