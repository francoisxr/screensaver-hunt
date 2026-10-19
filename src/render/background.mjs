// The background: a slow neon-green wave (after play.core's "sinsin_wave" demo, but much slower) with a
// Game of Life of tiny flies moving over it. Live cells light up the dark grass, and a fading trail
// follows them, so swarms of flies seem to glide across it. Merges and splits stir the swarm where they happen.
//
// The wave is a ring of box-drawing characters shifted by a slowly moving sine (the demo's bend term grows
// with the screen size, which on three monitors would make the far corner race, so it is normalised); each cell's brightness
// follows a second, softer wave, so the field shimmers. Brightness is quantised to a few levels so a
// row of the screen is a handful of colour runs instead of a different colour per cell.
// Over it all drifts a moire (see `cellAt`): rays from a horizon beating against the wave's stripes.

import { parseColor } from '../core/color.mjs'
import { TAU } from '../core/math.mjs'
import { Life } from './life.mjs'

const LEVELS = 12 // brightness steps
const CENTRE_X = [0.1, 0.9]  // the moire's vanishing point stays within these shares of the width...
const CENTRE_Y = [0.2, 0.8]  // ...and of the height
const STEER = 1.5            // how quickly it turns back when it reaches the edge of that region (per second)
const VERTICAL_SHARE = 0.8   // it covers the height a little slower than the width, relative to their sizes

export class Background {
  /**
   * @param {typeof import('../config/defaults.mjs').DEFAULTS.look.background} settings
   * @param {import('../core/rng.mjs').Rng} rng
   */
  constructor (settings, rng) {
    this.s = settings
    this.life = new Life(settings.life, rng)
    const base = parseColor(settings.color) || [57, 255, 20]
    // palette[k] is the colour at brightness k / (LEVELS - 1); cells share these arrays
    this.palette = Array.from({ length: LEVELS }, (_, k) => base.map(v => Math.round(v * k / (LEVELS - 1))))
    this.cellCache = new Map() // (char, level) -> the cell object, shared between frames
    this.rng = rng
    // Where the moire's vanishing point is, as a share of the width and height, and its heading. It starts
    // somewhere random and wanders (see `update`).
    this.centre = { x: rng.float(CENTRE_X[0], CENTRE_X[1]), y: rng.float(CENTRE_Y[0], CENTRE_Y[1]), heading: rng.float(0, TAU) }
    this.cols = 0
    this.rows = 0
  }

  /** The board covers all screens side by side. */
  resize (cols, rows) {
    this.cols = cols
    this.rows = rows
    this.life.resize(cols, rows)
  }

  update (dt) {
    this.life.update(dt)
    this.wander(dt)
  }

  /**
   * Moves the moire's vanishing point: slowly, in a gently curving line, turning back toward the middle
   * when it gets near an edge (it never jumps, so the fringes only ever drift).
   */
  wander (dt) {
    const { drift, turn } = this.s.moire
    const c = this.centre
    if (drift <= 0 || this.cols <= 0 || this.rows <= 0) return
    c.heading += this.rng.gauss() * turn * Math.sqrt(dt)
    const outside = c.x < CENTRE_X[0] || c.x > CENTRE_X[1] || c.y < CENTRE_Y[0] || c.y > CENTRE_Y[1]
    if (outside) { // steer back in: toward the middle of the allowed region
      const want = Math.atan2(0.5 - c.y, (0.5 - c.x) * this.cols / this.rows)
      const gap = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading))
      c.heading += gap * Math.min(1, STEER * dt)
    }
    const step = drift * dt / this.cols // the share of the width covered
    c.x += Math.cos(c.heading) * step
    c.y += Math.sin(c.heading) * step * this.cols / this.rows * VERTICAL_SHARE
    c.x = Math.min(CENTRE_X[1] + 0.05, Math.max(CENTRE_X[0] - 0.05, c.x))
    c.y = Math.min(CENTRE_Y[1] + 0.05, Math.max(CENTRE_Y[0] - 0.05, c.y))
  }

  /** The vanishing point of the moire, in columns and rows. */
  moireCentre () {
    return this.s.moire.drift > 0
      ? [this.centre.x * this.cols, this.centre.y * this.rows]
      : [this.cols / 2, this.rows * this.s.moire.horizon]
  }

  /** Stirs the swarm: a burst of new flies around a point (column, row), radius in rows. */
  stir (col, row, radius, density, aspect) {
    this.life.burst(col, row, radius, density, aspect)
  }

  /**
   * The background cell at a column and row of the combined area.
   * @param {number} seconds scene time
   * @returns {import('../core/frame.mjs').Cell}
   */
  cellAt (col, row, seconds) {
    const { s } = this
    const t = seconds * s.speed
    const x = col * s.scale
    const y = row
    const bend = s.warp * (col / this.life.cols) * (row / this.life.rows) * Math.sin(t) // the demo's x*y*0.003, normalised to the canvas
    const offset = Math.sin(bend + y * 0.01 + t) * 20
    const phase = x + y + offset // where this cell is along the wave's diagonal stripes
    const n = s.pattern.length

    // The moire: a second family of stripes, rays fanning out from a horizon (play.core's "time_frames"
    // demo). Where the two families agree the grass is bright and where they disagree it is dark, so
    // interference fringes drift across the field; the rays also shift which character the wave shows.
    const m = s.moire
    let ray = 0
    let beat = 1
    if (m.strength > 0) {
      const [centreCol, centreRow] = this.moireCentre()
      let z = row + 0.5 - centreRow
      if (Math.abs(z) < 0.5) z = z < 0 ? -0.5 : 0.5 // no division by zero on the horizon itself
      ray = (col - centreCol) / z * m.density + seconds * m.speed
      beat = 0.5 + 0.5 * Math.cos(TAU * (ray - phase) / n)
    }
    const index = Math.round(Math.abs(phase + ray * m.shift)) % n
    const char = s.pattern[index]

    // grass brightness: a soft second wave and the moire fringes, then lit up where flies are (and where they just were)
    const wave = 0.5 + 0.5 * Math.sin(col * 0.07 + row * 0.19 + t * 1.3)
    const grass = s.brightness * (1 - s.shimmer + s.shimmer * 2 * wave) * (1 - m.strength + m.strength * 2 * beat)
    const lit = grass + s.life.glow * this.life.intensity(col, row)
    const level = Math.max(0, Math.min(LEVELS - 1, Math.round(lit * (LEVELS - 1))))

    const key = char + level
    let cell = this.cellCache.get(key)
    if (!cell) {
      cell = { char, rgb: this.palette[level], bg: true } // bg marks it as background: hunters and necks draw over it
      this.cellCache.set(key, cell)
    }
    return cell
  }
}
