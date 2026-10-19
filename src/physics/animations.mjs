// The animations of merging and splitting, and how every hunter is drawn.
//
// While a hunter merges or splits, how it is drawn differs from where and how big it physically is:
// it has a visual offset (ox, oy), a drawMass (the size it is drawn at), an alpha (how solid it is)
// and a fuzz (how frayed its edge is). The two hunters of a merge, or the pieces of a split, must
// together cover an area that slides smoothly from their size before to their size after, so the
// drawn size never swells or snaps. `world.links` lists the groups joined by a slime neck, with the
// threshold that shapes the neck.

import { clamp01, smootherstep, sum } from '../core/math.mjs'
import { solveDrawnMass } from '../core/geometry.mjs'
import { finishMerge } from './merging.mjs'
import { finishSplit, solveSplitScale, pieceShift } from './splitting.mjs'

const DISSOLVE_START = 0.35   // the absorbed hunter starts to dissolve this far into a merge
const SCALE_SMOOTHING = 0.6   // steadies the split's common scale against noise from the area sampling
const SPLIT_SCALE_RANGE = [0.002, 0.998] // outside this progress the scale is simply 1
const DRAWN_MASS_RATE = 6     // how fast a hunter's drawn size follows its mass when not animating (per second)
const FUZZ_RATE = 2.5         // how fast the edge frays (per second); it settles back 2.5x slower
const FUZZ_SETTLE = 0.4
const FLARE_RATE = 1.6        // how fast a released piece's flare of specks dies away (per second)

/** Advances every merge and split animation, and finishes the ones that are over. */
export function updateAnimations (world) {
  const seen = new Set()
  const finished = []
  world.links = []
  for (const s of world.hunters) {
    const a = s.anim
    if (!a || seen.has(a)) continue
    seen.add(a)
    a.p = clamp01((world.t - a.t0) / a.dur)
    a.e = smootherstep(a.p)
    if (a.type === 'merge') animateMerge(world, a)
    else animateSplit(world, a)
    if (a.p >= 1) finished.push(a)
  }
  for (const a of finished) {
    if (a.type === 'merge') finishMerge(world, a)
    else finishSplit(world, a)
  }
}

function animateMerge (world, a) {
  const { e, p } = a
  const { keep, gone } = a
  keep.ox = a.keepOff[0] * (1 - e)
  keep.oy = a.keepOff[1] * (1 - e)
  gone.x = keep.x
  gone.y = keep.y
  gone.vx = keep.vx
  gone.vy = keep.vy
  gone.ox = a.goneOff[0] * (1 - e)
  gone.oy = a.goneOff[1] * (1 - e)

  // The two hunters together cover an area that slides from their combined size to the merged size.
  // The absorbed hunter shrinks away as it dissolves; the other is drawn at whatever size makes the
  // total come out.
  const dist = Math.hypot(a.goneOff[0] - a.keepOff[0], a.goneOff[1] - a.keepOff[1]) * (1 - e)
  const target = (a.total + (keep.mass - a.finalAtStart)) * (1 - e) + keep.mass * e
  gone.drawMass = Math.max(0, a.goneMass0 * (1 - e)) // (1 - e) can come out as -1e-16 at the very end
  keep.drawMass = solveDrawnMass(target, gone.drawMass, dist, world.r0)
  gone.alpha = Math.max(0, 1 - smootherstep((p - DISSOLVE_START) / (1 - DISSOLVE_START)))
  world.links.push({ ids: [keep.id, gone.id], thr: 1 + world.cfg.merging.neck * (1 - e) })
}

function animateSplit (world, a) {
  const { e } = a
  a.shift = pieceShift(world, a) // keeps the pieces inside the area when the split happens near a wall
  a.pieces.forEach((piece, i) => {
    if (i > 0) { piece.x = a.parent.x; piece.y = a.parent.y; piece.vx = a.parent.vx; piece.vy = a.parent.vy }
    piece.ox = a.offs[i][0] * e + a.shift[0]
    piece.oy = a.offs[i][1] * e + a.shift[1]
  })

  // The pieces together cover an area that slides from the sick hunter's size to the pieces' size:
  // shrink them all by a common factor to make it so.
  const base = a.pieces.map((_, i) => a.mass0 + (a.finals[i] - a.mass0) * e)
  const target = a.mass0 + (sum(a.finals) - a.mass0) * e
  const [lo, hi] = SPLIT_SCALE_RANGE
  const c = e > lo && e < hi ? solveSplitScale(world, a, base, target) : 1
  a.scale = a.scale === undefined ? c : a.scale + (c - a.scale) * SCALE_SMOOTHING
  a.pieces.forEach((piece, i) => { piece.drawMass = base[i] * a.scale })

  // While the pieces still overlap, n circles on top of each other would swell the neck region to
  // sqrt(n) times their radius, so the threshold starts high and only drops (a bridge forms) as they
  // part, then rises again so the neck thins out and breaks. Three pieces need a higher minimum to keep
  // the neck from adding area.
  const { neck } = world.cfg.splitting
  const high = Math.max(neck.high, a.pieces.length + 0.2)
  const low = a.pieces.length === 2 ? neck.low2 : neck.low3
  world.links.push({ ids: a.pieces.map(x => x.id), thr: high - (high - low) * Math.sin(Math.PI * e) })
}

/**
 * How every hunter is drawn, after the animations: its drawn size follows its mass smoothly (eating
 * and shrinking are not jumps), and its edge frays while it is sick (or about to be) and settles slowly.
 */
export function relaxVisuals (world, dt) {
  const relax = Math.min(1, dt * DRAWN_MASS_RATE)
  const fray = Math.min(1, dt * FUZZ_RATE)
  for (const s of world.hunters) {
    s.flare *= Math.exp(-FLARE_RATE * dt)
    if (!s.anim) s.drawMass += (s.mass - s.drawMass) * relax
    const a = s.anim
    const frayed = s.sickUntil !== 0 || (a && a.type === 'merge' && a.willBeSick && a.keep === s)
    s.fuzz += ((frayed ? 1 : 0) - s.fuzz) * (frayed ? fray : fray * FUZZ_SETTLE)
  }
}
