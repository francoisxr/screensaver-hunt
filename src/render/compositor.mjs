// The compositor: draws one screen's slice of the world into a grid of cells.
//
// It is a set of pure functions: the world's hunters, necks and cookies, each dish's latest picture
// and the look settings go in; a grid comes out. Nothing here talks to the network, the clock or the
// worker threads, so it can be tested and reused on its own.
//
// All screens sit side by side as one wide area. A screen knows where it starts in that area (col0),
// and anything partly off the screen is clipped.
//
// Layers, bottom to top: the background, the hunters (biggest first), the slime necks, the cookies.
// Background cells are marked `bg`. Hunters are transparent: only their characters are drawn, and the
// background shows through the gaps. Necks draw over the background too.

import { BINS, wobbleTable, binOf, unstretch } from './wobble.mjs'
import { bodyOf } from './body.mjs'
import { DISH_RADIUS_PER_ROW } from './dish.mjs'
import { cookieCells, WIDTH as COOKIE_W, HEIGHT as COOKIE_H } from './cookie-shape.mjs'

const MIN_ALPHA = 0.01          // hunters this faint are not drawn
const FUZZ_MIN = 0.02           // below this a hunter has no frayed edge
const RIM_PER_RADIUS = 0.9      // the fray works on how deep a cell is inside the body: 1 at the edge, less inside, more outside
const RIM_START = 0.78          // the rim frays from this share of the radius...
const RIM_WIDTH = 0.22          // ...over this much more of it
const RIM_STRENGTH = 0.8        // ...losing up to this many of its cells
const RIM_GAP_SHARE = 0.45      // of the cells that go, this share become blank (the rest become specks)
const SPECK_INNER = 0.95        // specks drift outside the rim between these shares of the radius
const SPECK_OUTER = 1.15
const SPECK_CHANCE = 0.14
const STRETCH_FROM = 6          // a hunter stretches from this speed (units/s)...
const STRETCH_FULL = 22         // ...to its full stretch at this speed
const WOBBLE_FULL_SPEED = 30    // speed at which the speed-dependent ripple is at its maximum
const SICK_RIPPLE_SPEED = 1.5   // a sick hunter's outline ripples this much faster
const NECK_REACH = 1.6          // the area searched for neck cells, in radii around the hunters
const NECK_DENSITY_SPAN = 1.0   // how far above the threshold the neck is at its densest

/**
 * @typedef {object} Screen
 * @property {number} cols
 * @property {number} rows
 * @property {number} col0   where this screen starts in the combined area, in columns
 */

/**
 * @typedef {object} ComposeInput
 * @property {Screen} screen
 * @property {import('../physics/hunter.mjs').Hunter[]} hunters
 * @property {{ids: number[], thr: number}[]} links groups of hunters joined by a neck
 * @property {{id: number, x: number, y: number}[]} cookies
 * @property {(id: number) => (ReturnType<import('../play/instance.mjs').ProgramInstance['snapshot']> | undefined)} dishFrame
 *   a hunter's latest picture, or undefined if it has none yet
 * @property {(id: number) => import('./cookie-animator.mjs').CookieView} cookieView
 * @property {(id: number, seconds: number) => ((light: number) => number[])} cookieShade
 * @property {number} aspect  character width / height
 * @property {number} seconds scene time
 * @property {typeof import('../config/defaults.mjs').DEFAULTS.look} look
 * @property {import('../core/rng.mjs').Rng} rng
 * @property {{ cellAt: (col: number, row: number, seconds: number) => import('../core/frame.mjs').Cell } | null} [background]
 *   the bottom layer, if any (see background.mjs)
 * @property {number} [r0] the radius of a mass-1 hunter, in rows: hunters are drawn at their exact size (default: from the size of the dish window)
 * @property {{ cols: number, rows: number } | null} [wrap]
 *   the size of the whole area in columns and rows when the world wraps around: things near an edge are
 *   drawn again on the other side, so a hunter can sit half across it
 * @property {Float32Array} [scratch] reused buffer for the wobble, to avoid allocating
 */

/**
 * Draws one screen.
 * @param {ComposeInput} input
 * @returns {{ grid: (import('../core/frame.mjs').Cell | null)[], neckCells: number }}
 */
export function composeScreen (input) {
  const { screen, hunters } = input
  const grid = new Array(screen.cols * screen.rows).fill(null)
  const scratch = input.scratch ?? new Float32Array(BINS)
  if (input.background) drawBackground(grid, input)

  // Biggest first, so small hunters draw on top if they overlap.
  for (const hunter of [...hunters].sort((a, b) => b.mass - a.mass)) {
    for (const [offCol, offRow] of wrapOffsets(input.wrap)) drawHunter(grid, hunter, input, scratch, offCol, offRow)
  }
  const neckCells = drawNecks(grid, input)
  drawCookies(grid, input)
  return { grid, neckCells }
}

/** The bottom layer: every cell of the screen. */
function drawBackground (grid, input) {
  const { screen, background, seconds } = input
  for (let y = 0; y < screen.rows; y++) {
    for (let x = 0; x < screen.cols; x++) grid[x + y * screen.cols] = background.cellAt(screen.col0 + x, y, seconds)
  }
}

/**
 * Where to draw things that might be near an edge of a world that wraps: where they are, and a screen
 * width or height away on each side (so the part that sticks out of one edge shows up at the other).
 * @returns {[number, number][]} column and row offsets
 */
function wrapOffsets (wrap) {
  if (!wrap) return [[0, 0]]
  const offsets = []
  for (const r of [0, -1, 1]) for (const c of [0, -1, 1]) offsets.push([c * wrap.cols, r * wrap.rows])
  return offsets
}

/**
 * One hunter: its body (see body.mjs) with its dish shown inside, dissolved if it is fading and with a
 * frayed edge if it is sick. Every screen cell near the hunter is asked "are you inside the body?"; if so
 * it shows the dish cell at the matching place (the dish is squeezed a little so that the whole body,
 * which can reach beyond a disc, falls inside it).
 */
function drawHunter (grid, sp, input, scratch, offCol = 0, offRow = 0) {
  const { screen, aspect, look, rng } = input
  const res = input.dishFrame(sp.id)
  if (!res || sp.alpha < MIN_ALPHA) return

  const fuzz = sp.fuzz
  // Where the body is centred: on a cell boundary, decided by the hunter's position alone. (Not by the dish
  // window, whose size is a whole number of cells that keeps changing while the hunter grows or shrinks:
  // the body would shift by half a cell each time.) Its size comes from the hunter's exact size for the
  // same reason; the dish picture is simply scaled to fit it.
  const centreCol = Math.round((sp.x + sp.ox) / aspect) + offCol
  const centreRow = Math.round(sp.y + sp.oy) + offRow
  const dishRadius = DISH_RADIUS_PER_ROW * res.rows
  const radius = input.r0 ? input.r0 * Math.sqrt(Math.max(sp.drawMass, 1e-6)) : dishRadius / look.pad // the radius of the hunter on screen, in rows

  const body = bodyOf(sp.id, look.body, sp.bornFrom)
  body.pose(input.seconds)
  const reach = body.reachAt(input.seconds, look.body.growSeconds)

  // The outline ripples: more when the hunter moves fast, and wilder (and quicker) while it is sick.
  const speed = Math.hypot(sp.vx, sp.vy)
  const amp = Math.min(0.5, look.wobble.base + look.wobble.speed * Math.min(speed, WOBBLE_FULL_SPEED) / WOBBLE_FULL_SPEED + look.wobble.sick * fuzz)
  const table = wobbleTable(body.rippleId, input.seconds * (1 + SICK_RIPPLE_SPEED * fuzz), amp, scratch)

  // Lunging: a fast hunter is longer along its motion and narrower across it.
  const S = 1 + look.stretch * Math.max(0, Math.min(1, (speed - STRETCH_FROM) / (STRETCH_FULL - STRETCH_FROM)))
  const ux = speed > 1e-6 ? sp.vx / speed : 1
  const uy = speed > 1e-6 ? sp.vy / speed : 0

  const halfRows = Math.ceil((body.maxReach * S + 0.3) * radius) + 1
  const halfCols = Math.ceil(halfRows / aspect) + 1
  const cx = res.cols / 2
  const cy = res.rows / 2
  const squeeze = dishRadius / (radius * reach) // screen rows to dish rows: the whole body fits inside the dish

  for (let sy = Math.max(0, Math.floor(centreRow) - halfRows); sy <= Math.min(screen.rows - 1, Math.ceil(centreRow) + halfRows); sy++) {
    for (let sx = Math.max(0, Math.floor(centreCol) - halfCols - screen.col0); sx <= Math.min(screen.cols - 1, Math.ceil(centreCol) + halfCols - screen.col0); sx++) {
      const qx = (sx + screen.col0 + 0.5 - centreCol) * aspect
      const qy = sy + 0.5 - centreRow
      const [px, py] = S > 1.002 ? unstretch(qx, qy, ux, uy, S) : [qx, qy]
      const bx = px / radius
      const by = py / radius

      // inside the body? (it starts as a disc or as its parent's body and grows into its own shape; the outline ripples)
      const f = body.field(bx, by, input.seconds, look.body.growSeconds) - table[binOf(bx, by)]
      if (f > 0 && fuzz < FUZZ_MIN) continue

      let ch = ' '
      let idx = -1
      if (f <= 0) {
        const si = Math.floor(cx + px * squeeze / aspect)
        const sj = Math.floor(cy + py * squeeze)
        if (si >= 0 && si < res.cols && sj >= 0 && sj < res.rows) { idx = si + sj * res.cols; ch = res.chars[idx] }
      }
      if (ch === ' ' && fuzz < FUZZ_MIN) continue
      if (sp.alpha < 1 && cellHash(sx + screen.col0 - centreCol, sy - centreRow, sp.id) > sp.alpha) continue // fading in or dissolving, cell by cell

      if (fuzz > FUZZ_MIN) ch = fray(ch, 1 + RIM_PER_RADIUS * f, fuzz, look.fuzz, rng)
      if (ch === ' ') continue
      grid[sx + sy * screen.cols] = res.colors && idx >= 0
        ? { char: ch, color: res.colors[idx], back: res.backs[idx] }
        : { char: ch, color: null }
    }
  }
}

/**
 * The frayed edge of a sick hunter: cells near the rim drop out or turn into specks, and specks
 * drift just outside it. `rho` is the distance from the centre as a share of the dish radius.
 */
function fray (ch, rho, fuzz, specks, rng) {
  if (ch !== ' ') {
    if (rho > RIM_START && rng.random() < (rho - RIM_START) / RIM_WIDTH * RIM_STRENGTH * fuzz) {
      return rng.random() < RIM_GAP_SHARE ? ' ' : specks[Math.floor(rng.random() * specks.length)]
    }
  } else if (rho > SPECK_INNER && rho < SPECK_OUTER && rng.random() < SPECK_CHANCE * fuzz) {
    return specks[Math.floor(rng.random() * specks.length)]
  }
  return ch
}

/**
 * A fixed pseudo-random number in [0, 1) for a cell of a hunter, so a fading hunter dissolves cell by
 * cell instead of flickering.
 */
export function cellHash (i, j, id) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(id, 2246822519)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Necks: slime joining hunters that are merging, or still holding the pieces of a split. Each hunter
 * contributes a field of r^2 / d^2; where the sum passes the link's threshold (and nothing else is
 * drawn) the neck is drawn, denser the further past it (metaballs). A higher threshold is a thinner neck.
 * @returns {number} how many neck cells were drawn
 */
function drawNecks (grid, input) {
  const { aspect, look } = input
  const areaW = input.wrap ? input.wrap.cols * aspect : 0
  const areaH = input.wrap ? input.wrap.rows : 0
  let drawn = 0
  for (const link of input.links) {
    const balls = []
    for (const id of link.ids) {
      const sp = input.hunters.find(x => x.id === id)
      const res = input.dishFrame(id)
      if (sp && res) balls.push({ x: sp.x + sp.ox, y: sp.y + sp.oy, r: DISH_RADIUS_PER_ROW * res.rows / look.pad })
    }
    if (balls.length < 2) continue
    if (input.wrap) { // the short way round: bring every ball next to the first one
      for (const b of balls.slice(1)) {
        b.x -= areaW * Math.round((b.x - balls[0].x) / areaW)
        b.y -= areaH * Math.round((b.y - balls[0].y) / areaH)
      }
    }

    for (const [offCol, offRow] of wrapOffsets(input.wrap)) {
      const shifted = balls.map(b => ({ ...b, x: b.x + offCol * aspect, y: b.y + offRow }))
      drawn += drawNeck(grid, input, link, shifted)
    }
  }
  return drawn
}

/** One neck, between balls already placed where they are to be drawn. */
function drawNeck (grid, input, link, balls) {
  const { screen, aspect, look } = input
  let drawn = 0
  const x0 = Math.min(...balls.map(b => b.x - NECK_REACH * b.r))
  const x1 = Math.max(...balls.map(b => b.x + NECK_REACH * b.r))
  const y0 = Math.min(...balls.map(b => b.y - NECK_REACH * b.r))
  const y1 = Math.max(...balls.map(b => b.y + NECK_REACH * b.r))
  for (let gr = Math.max(0, Math.floor(y0)); gr <= Math.min(screen.rows - 1, Math.ceil(y1)); gr++) {
    for (let gc = Math.max(screen.col0, Math.floor(x0 / aspect)); gc <= Math.min(screen.col0 + screen.cols - 1, Math.ceil(x1 / aspect)); gc++) {
      const sx = gc - screen.col0
      const there = grid[sx + gr * screen.cols]
      if (there && !there.bg) continue // something other than the background is already drawn here
      const px = (gc + 0.5) * aspect
      const py = gr + 0.5
      let f = 0
      for (const b of balls) f += (b.r * b.r) / Math.max(1e-3, (px - b.x) ** 2 + (py - b.y) ** 2)
      if (f < link.thr) continue
      const density = Math.min(1, (f - link.thr) / NECK_DENSITY_SPAN)
      const row = look.neckTexture[(gc + gr) % look.neckTexture.length]
      const ch = row[Math.ceil(density * (row.length - 1))]
      if (ch === ' ') continue
      grid[sx + gr * screen.cols] = { char: ch, color: null }
      drawn++
    }
  }
  return drawn
}

/** Cookies on top: small animated digital rings, centred on their spot (plus the shiver), clipped at the screen edge. */
function drawCookies (grid, input) {
  const { screen, aspect, look } = input
  for (const c of input.cookies) {
    const view = input.cookieView(c.id)
    const shade = input.cookieShade(c.id, input.seconds)
    const cells = cookieCells(c.id, view, aspect, look.cookies.shape)
    for (const [offCol, offRow] of wrapOffsets(input.wrap)) {
      const col = Math.floor(c.x / aspect) - Math.floor(COOKIE_W / 2) - screen.col0 + view.jx + offCol
      const row = Math.floor(c.y) - Math.floor(COOKIE_H / 2) + view.jy + offRow
      for (const cell of cells) {
        const sx = col + cell.dx
        const sy = row + cell.dy
        if (sx >= 0 && sx < screen.cols && sy >= 0 && sy < screen.rows) {
          grid[sx + sy * screen.cols] = { char: cell.char, rgb: shade(cell.light), bold: true }
        }
      }
    }
  }
}
