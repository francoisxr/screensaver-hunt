// Splitting. A hunter whose sickness has run its course splits into two or three pieces with 75% of
// its mass in total (the pieces differ in size by about +-20%). The split is an animation (see
// animations.mjs): the pieces start as exact copies of the sick hunter, all on top of each other,
// and ease apart until they just touch.

import { TAU, sum } from '../core/math.mjs'
import { unionMass } from '../core/geometry.mjs'
import { createHunter } from './hunter.mjs'
import { pruneContacts } from './collisions.mjs'

const RING_STEP = 0.1       // how finely the ring the pieces sit on is searched for (units)
const RING_SEARCH = 400     // ...and how many steps are tried
const TOUCH_GAP = 1.02      // pieces end up this many touching distances apart
const SCALE_BRACKET = [0.3, 1.05] // range searched for the common shrink factor of the pieces
const SCALE_ITERATIONS = 12

/**
 * A sick hunter's time is up: it stretches into pieces that ease apart. With no room for more
 * hunters it just recovers (still losing the mass).
 * @param {import('./world.mjs').World} world
 * @param {import('./hunter.mjs').Hunter} p the sick hunter (it carries on as the first piece)
 */
export function startSplit (world, p) {
  const { splitting, merging } = world.cfg
  const { rng } = world
  let pieces = rng.chance(0.5) ? 2 : 3
  pieces = Math.min(pieces, 1 + (world.cfg.hunters.max - world.hunters.length)) // as many as there is room for
  p.sickUntil = 0
  if (pieces < 2) {
    p.mass *= 1 - splitting.loss
    p.immuneUntil = world.t + merging.immunity
    world.log('recover', { id: p.id, mass: +p.mass.toFixed(2) })
    return
  }

  // The pieces differ in size by about +-20%; together they hold 75% of the mass.
  const mass0 = p.mass
  const total = mass0 * (1 - splitting.loss)
  const raw = Array.from({ length: pieces }, () => (1 + rng.float(-splitting.sizeJitter, splitting.sizeJitter)) ** 2)
  const rawSum = sum(raw)
  const finals = raw.map(m => m / rawSum * total)
  const offs = pieceOffsets(world, finals, total)

  // The first piece is the sick hunter itself; the others follow it as ghosts until released.
  const list = [p]
  for (let i = 1; i < pieces; i++) {
    const piece = createHunter(world, p.x, p.y, finals[i])
    piece.ghost = true
    piece.vx = p.vx
    piece.vy = p.vy
    piece.drawMass = mass0
    piece.alpha = 1 // an exact copy of the parent at first, so there is nothing to fade in
    piece.fuzz = p.fuzz
    piece.agit = p.agit
    piece.bornFrom = p.id // the scene copies the parent's look into the new piece
    piece.immuneUntil = world.t + merging.immunity + splitting.seconds
    world.hunters.push(piece)
    list.push(piece)
  }
  const anim = { type: 'split', parent: p, pieces: list, t0: world.t, dur: splitting.seconds, offs, mass0, finals, p: 0, e: 0 }
  for (const s of list) s.anim = anim
  p.mass = total // the parent's body carries all the pieces' mass until they separate
  world.log('split', { parent: p.id, pieces: list.map(s => s.id), masses: finals.map(m => +m.toFixed(2)) })
}

/**
 * Where each piece ends up, relative to the parent's centre: on a ring, just touching, with the
 * centre of mass where it was.
 * @returns {[number, number][]}
 */
function pieceOffsets (world, finals, total) {
  const n = finals.length
  const radii = finals.map(m => world.r0 * Math.sqrt(m))
  const base = world.rng.float(0, TAU)
  const dirs = finals.map((_, i) => [Math.cos(base + i * TAU / n), Math.sin(base + i * TAU / n)])
  let ring = 0.5 * (sum(radii) / n)
  for (let step = 0; step < RING_SEARCH; step++, ring += RING_STEP) {
    let ok = true
    for (let i = 0; i < n && ok; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot((dirs[i][0] - dirs[j][0]) * ring, (dirs[i][1] - dirs[j][1]) * ring)
        if (d < (radii[i] + radii[j]) * TOUCH_GAP) { ok = false; break }
      }
    }
    if (ok) break
  }
  const offs = dirs.map(d => [d[0] * ring, d[1] * ring])
  const cmx = offs.reduce((x, o, i) => x + o[0] * finals[i], 0) / total
  const cmy = offs.reduce((x, o, i) => x + o[1] * finals[i], 0) / total
  return offs.map(o => [o[0] - cmx, o[1] - cmy])
}

/**
 * How far to shift the whole group of pieces, right now, so that none of them pokes out of the area.
 * Near a wall the ring the pieces sit on would otherwise stick out; they would be released outside
 * and snapped back with a jump. Shifting the group inward as it parts keeps everything smooth.
 * @returns {[number, number]}
 */
export function pieceShift (world, anim) {
  if (world.cfg.wrap) return [0, 0] // no walls to poke out of
  const { walls } = world.cfg
  let lowX = 0
  let highX = 0
  let lowY = 0
  let highY = 0
  anim.pieces.forEach((_, i) => {
    const margin = walls.hard * world.r0 * Math.sqrt(anim.finals[i])
    const x = anim.parent.x + anim.offs[i][0] * anim.e
    const y = anim.parent.y + anim.offs[i][1] * anim.e
    lowX = Math.max(lowX, margin - x)
    highX = Math.min(highX, world.w - margin - x)
    lowY = Math.max(lowY, margin - y)
    highY = Math.min(highY, world.h - margin - y)
  })
  return [lowX + highX, lowY + highY]
}

/** The split animation is over: the pieces are released as separate hunters. */
export function finishSplit (world, anim) {
  const { splitting, merging } = world.cfg
  const { parent, pieces, offs, finals } = anim
  const shift = anim.shift ?? [0, 0]
  const cx = parent.x + shift[0]
  const cy = parent.y + shift[1]
  const vx = parent.vx
  const vy = parent.vy
  pieces.forEach((s, i) => {
    s.x = cx + offs[i][0]
    s.y = cy + offs[i][1]
    world.wrapPoint(s)
    s.ox = s.oy = 0
    s.ghost = false
    s.anim = null
    s.alpha = 1
    s.mass = finals[i]
    s.drawMass = finals[i]
    s.immuneUntil = world.t + merging.immunity
    const len = Math.hypot(offs[i][0], offs[i][1]) || 1
    const speed = world.rng.range(splitting.releaseSpeed)
    s.vx = vx + offs[i][0] / len * speed
    s.vy = vy + offs[i][1] / len * speed
  })
  world.log('split-done', { parent: parent.id })
  pruneContacts(world)
}

/**
 * The common factor to draw a splitting hunter's pieces at, so that together they cover `target`
 * mass of area (found by bisection on the area of their union).
 * @param {number[]} base each piece's mass before the factor
 */
export function solveSplitScale (world, anim, base, target) {
  const circles = c => anim.pieces.map((piece, i) => ({
    x: anim.parent.x + piece.ox,
    y: anim.parent.y + piece.oy,
    r: world.r0 * Math.sqrt(Math.max(1e-6, base[i] * c)),
  }))
  let [lo, hi] = SCALE_BRACKET
  for (let i = 0; i < SCALE_ITERATIONS; i++) {
    const c = (lo + hi) / 2
    if (unionMass(circles(c), world.r0) < target) lo = c
    else hi = c
  }
  return (lo + hi) / 2
}
