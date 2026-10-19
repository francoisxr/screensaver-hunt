// The animation state of every cookie: how afraid it is, the phases of its breathing and flicker, and
// where it trembles to. Cookies cannot move, so when a hunter comes near they shiver in place, as if
// afraid of being eaten. This is view state: the physics knows nothing about it.
//
// Fear rises fast as a hunter's edge gets close and fades slowly; a frightened cookie breathes and
// flickers faster. A shiver can only be whole characters, so a frightened cookie jumps around its spot
// a few times a second, more often and further the more afraid it is.

import { clamp01 } from '../core/math.mjs'

const FEAR_RISE = 6       // how fast fear rises (per second)
const FEAR_FALL = 1.5     // ...and falls
const BREATH_BOOST = 2.5  // a cookie at fear 1 breathes 3.5x faster
const FLICKER_BOOST = 1.5 // ...and flickers 2.5x faster

/**
 * @typedef {object} CookieView
 * @property {number} fear     0..1
 * @property {number} pulse    phase of the breathing, radians
 * @property {number} shimmer  phase of the flicker, radians
 * @property {number} jx       current shiver offset, in columns
 * @property {number} jy       ...and in rows
 * @property {number} step     which tick of the shiver clock it last jumped on
 */

export class CookieAnimator {
  /**
   * @param {typeof import('../config/defaults.mjs').DEFAULTS.look.cookies} look
   * @param {import('../core/rng.mjs').Rng} rng
   */
  constructor (look, rng) {
    this.look = look
    this.rng = rng
    /** @type {Map<number, CookieView>} */
    this.views = new Map()
  }

  /** The state of one cookie (a calm default if it has not been updated yet). */
  view (id) {
    return this.views.get(id) ?? { fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0, step: -1 }
  }

  /**
   * Advances every cookie.
   * @param {{id: number, x: number, y: number}[]} cookies
   * @param {{x: number, y: number}[]} hunters the hunters that can scare them
   * @param {(hunter: object) => number} radiusOf a hunter's radius, units
   * @param {number} dt seconds since the last update
   * @param {number} timeMs scene time, milliseconds
   * @param {{ pulseSpeed: number, shimmerSpeed: number }} shape speeds of the breathing and flicker when calm
   */
  update (cookies, hunters, radiusOf, dt, timeMs, shape, distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)) {
    const { fear: fearSettings } = this.look
    const { rng } = this
    const step = Math.floor(timeMs / 1000 * fearSettings.shiverHz)
    const alive = new Set()

    for (const c of cookies) {
      alive.add(c.id)
      let edge = Infinity
      for (const s of hunters) edge = Math.min(edge, distance(s, c) - radiusOf(s))
      // (Clamp before the power: a negative number to the power 1.3 is NaN, which would freeze a cookie
      // that is far from every hunter.)
      const threat = Math.max(fearSettings.nervous, clamp01(1 - edge / fearSettings.range) ** 1.3)

      let v = this.views.get(c.id)
      if (!v) {
        v = { fear: threat, pulse: rng.random() * 6, shimmer: rng.random() * 6, jx: 0, jy: 0, step: -1 }
        this.views.set(c.id, v)
      }
      v.fear += (threat - v.fear) * Math.min(1, dt * (threat > v.fear ? FEAR_RISE : FEAR_FALL))
      v.pulse += dt * shape.pulseSpeed * (1 + BREATH_BOOST * v.fear)
      v.shimmer += dt * shape.shimmerSpeed * (1 + FLICKER_BOOST * v.fear)

      if (step !== v.step) { // time to jump to a new spot
        v.step = step
        const f = v.fear
        v.jx = rng.chance(0.25 + 0.55 * f) ? rng.sign() * (rng.chance(f * 0.35) ? 2 : 1) : 0
        v.jy = rng.chance(f * 0.4) ? rng.sign() : 0
      }
    }
    for (const id of this.views.keys()) if (!alive.has(id)) this.views.delete(id)
  }
}
