// A hunter: one dish of the simulation. Plain data, no behaviour; the modules next to this one
// (forces, hunting, merging, splitting...) change it.

import { TAU } from '../core/math.mjs'

/**
 * @typedef {object} Hunter
 * @property {number} id            unique among hunters and cookies
 * @property {number} x             position, in units (1 unit = one terminal row)
 * @property {number} y
 * @property {number} vx            velocity, units/s
 * @property {number} vy
 * @property {number} ax            acceleration for the current step
 * @property {number} ay
 * @property {number} ang           heading of its random drift
 * @property {number} mass          in base masses; its area. Radius = r0 * sqrt(mass)
 * @property {number} sickUntil     0, or the time its sickness ends (then it splits)
 * @property {number} calmUntil     after a burst it lies low (brakes, does not hunt) until this time
 * @property {number} immuneUntil   it cannot merge before this time
 * @property {number} kickIn        seconds until its next sick jolt
 * @property {number} agit          how agitated it moves, 0..1 (follows sickness, lets go slowly)
 * @property {{cookie: number, t0: number, react: number, burst: boolean} | null} hunt  the chase it is on
 * @property {{c: object, drive: number, d: number} | null} prey  this step's target
 * @property {number} stalkId        the hunter it is stalking (it sticks with its prey), 0 if none
 * @property {boolean} pounce       it has just picked a prey and is about to pounce
 * @property {number} recoilUntil   after a failed catch it does not chase until this time
 * @property {number} boostUntil    the prey of a failed catch runs extra hard until this time
 * @property {number} digestUntil   after eating another hunter, it does not hunt hunters until this time
 * @property {number} fullUntil     full after eating until this time: it hunts half-heartedly
 * @property {{from: number, until: number} | null} slow  slowed after eating a cookie, between these times
 * @property {{ux: number, uy: number, speed: number, t0: number, fade: number} | null} entering  on its way in: walking in from outside the area (speed > 0), or fading in
 * @property {{ux: number, uy: number, speed: number, t0: number, fade: number} | null} leaving   on its way out: walking off through an edge (speed > 0), or fading out
 * @property {{target: object, d: number} | null} stalk  the hunter it is hunting down this step
 * @property {{from: object, d: number} | null} threat   the hunter hunting it down this step
 * @property {number} bornFrom      id of the hunter a split piece came from (0 if none)
 * @property {boolean} ghost        a follower during a merge or split: drawn, but no physics of its own
 * @property {object | null} anim   the merge or split it is part of
 * How it is drawn (these differ from the physical values while it merges or splits):
 * @property {number} ox            visual offset from (x, y)
 * @property {number} oy
 * @property {number} drawMass      the size it is drawn at
 * @property {number} alpha         how solid it is, 0..1
 * @property {number} fuzz          how frayed its edge is, 0..1
 * @property {number} flare         a burst of shed specks around it, 0..1, dying away (set when a split releases a piece)
 */

/**
 * @param {import('./world.mjs').World} world
 * @returns {Hunter}
 */
export function createHunter (world, x, y, mass) {
  return {
    id: world.nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    ang: world.rng.float(0, TAU),
    mass,
    sickUntil: 0,
    calmUntil: 0,
    immuneUntil: 0,
    kickIn: 0,
    agit: 0,
    hunt: null,
    prey: null,
    fullUntil: 0,
    digestUntil: 0,
    stalkId: 0,
    pounce: false,
    recoilUntil: 0,
    boostUntil: 0,
    slow: null,
    entering: null,
    leaving: null,
    stalk: null,
    threat: null,
    bornFrom: 0,
    ghost: false,
    anim: null,
    ox: 0,
    oy: 0,
    drawMass: mass,
    alpha: 1,
    fuzz: 0,
    flare: 0,
  }
}

/** A random starting mass: sizes vary by `sizeJitter`, and the mass is the square of the size (it is an area). */
export function randomMass (world) {
  const { sizeJitter } = world.cfg.hunters
  const size = 1 + world.rng.float(-sizeJitter, sizeJitter)
  return size * size
}

/**
 * Places the starting hunters at random, apart from each other (and from the corners, when there are
 * walls), then makes sure at least one of them is big enough to hunt its closest neighbour at once.
 * @param {import('./world.mjs').World} world
 */
export function placeHunters (world) {
  const { w, h, cfg, rng } = world
  for (let i = 0; i < cfg.hunters.count; i++) {
    const s = createHunter(world, 0, 0, randomMass(world))
    const r = world.radius(s)
    let best = null
    for (let tries = 0; tries < 1000; tries++) {
      const m = cfg.wrap ? 0 : cfg.walls.soft * r
      const x = rng.float(m, Math.max(m, w - m))
      const y = rng.float(m, Math.max(m, h - m))
      const clearOfHunters = world.hunters.every(o => Math.hypot(world.dx(o.x - x), world.dy(o.y - y)) > (world.radius(o) + r) * 1.1)
      const clearOfCorners = world.corners.every(c => Math.hypot(c[0] - x, c[1] - y) > cfg.corners.range * r)
      if (clearOfHunters && clearOfCorners) { best = { x, y }; break }
      if (!best) best = { x, y }
    }
    s.x = best.x
    s.y = best.y
    world.hunters.push(s)
  }
  makeOneReadyToHunt(world)
}

/**
 * If no hunter is big enough to hunt its closest neighbour (see `hunting.stalk.ratio`), the pair with the
 * best chance gets there: the bigger one grows (never into sickness) until it is.
 * @param {import('./world.mjs').World} world
 */
export function makeOneReadyToHunt (world) {
  const { ratio, drive } = world.cfg.hunting.stalk
  if (drive <= 0 || world.hunters.length < 2) return
  let best = null
  for (const a of world.hunters) {
    let near = null
    let nearest = Infinity
    for (const b of world.hunters) {
      if (b === a) continue
      const d = world.distance(a, b)
      if (d < nearest) { nearest = d; near = b }
    }
    const need = near.mass * ratio * 1.1
    if (a.mass >= near.mass * ratio) return // somebody is ready already
    if (!best || need - a.mass < best.need - best.hunter.mass) best = { hunter: a, need }
  }
  best.hunter.mass = Math.min(best.need, world.cfg.sickness.mass * 0.95)
  best.hunter.drawMass = best.hunter.mass
}
