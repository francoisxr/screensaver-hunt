// Population: keeps the number of hunters around its starting number. With less than 75% of it, new
// hunters arrive; with more than 125%, one of them leaves. While a hunter is on its way in or out it is
// not part of the game: it does not merge, hunt, eat or get hunted.
//
// In a world with walls they walk in from outside an edge and off through the nearest one. In a world
// that wraps around there is no outside, so a newcomer fades in where there is room and a leaver (the
// smallest) fades away.

import { smootherstep } from '../core/math.mjs'
import { createHunter, randomMass } from './hunter.mjs'

const ENTRY_TRIES = 40
const ENTRY_CLEARANCE = 2.6   // a new hunter does not come in where another is within this many of its radii of the spot it is heading for
const SETTLED = 0.8           // a newcomer is "in" once its centre is this many radii inside the area

/** A hunter in transit: coming in, or leaving. */
export const inTransit = s => Boolean(s.entering || s.leaving)

/** A hunter that is walking in or off (rather than fading): its velocity is not its own. */
export const walking = s => Boolean((s.entering || s.leaving)?.speed > 0)

/**
 * Starts a new hunter on its way in, if there are too few, or sends one away, if there are too many. At
 * most one per `every` seconds.
 * @param {import('./world.mjs').World} world
 * @param {import('./hunter.mjs').Hunter[]} bodies
 */
export function managePopulation (world, bodies, dt) {
  const { hunters } = world.cfg
  const { population } = hunters
  world.populationTimer -= dt
  if (world.populationTimer > 0 || population.every[1] <= 0 || hunters.count <= 0) return // (count 0: a scripted world, nobody comes or goes)

  const counted = bodies.filter(s => !s.leaving).length
  if (counted < hunters.count * population.low && world.hunters.length < hunters.max) {
    if (welcomeHunter(world)) world.populationTimer = world.rng.range(population.every)
  } else if (counted > hunters.count * population.high) {
    if (sendAway(world, bodies)) world.populationTimer = world.rng.range(population.every)
  }
}

/** A new hunter arrives, where there is room. @returns {boolean} whether there was room */
function welcomeHunter (world) {
  const { w, h, rng } = world
  const { travel, fade } = world.cfg.hunters.population
  const s = createHunter(world, 0, 0, randomMass(world))
  const r = world.radius(s)

  if (world.cfg.wrap) { // it fades in somewhere with room around it
    for (let tries = 0; tries < ENTRY_TRIES; tries++) {
      const x = rng.float(0, w)
      const y = rng.float(0, h)
      if (world.hunters.some(o => Math.hypot(world.dx(o.x - x), world.dy(o.y - y)) < (world.radius(o) + r) * ENTRY_CLEARANCE / 2)) continue
      s.x = x
      s.y = y
      s.alpha = 0
      s.entering = { ux: 0, uy: 0, speed: 0, t0: world.t, fade }
      world.hunters.push(s)
      world.log('arrive', { id: s.id, mass: +s.mass.toFixed(2) })
      return true
    }
    return false
  }

  let best = null
  for (let tries = 0; tries < ENTRY_TRIES && !best; tries++) {
    // an edge, more likely the longer it is
    const pick = rng.float(0, 2 * (w + h))
    const edge = pick < w ? 0 : pick < w + h ? 1 : pick < 2 * w + h ? 2 : 3 // top, right, bottom, left
    const along = rng.float(0.1, 0.9)
    const [x, y, ux, uy] = [
      [along * w, -r * 1.05, 0, 1],
      [w + r * 1.05, along * h, -1, 0],
      [along * w, h + r * 1.05, 0, -1],
      [-r * 1.05, along * h, 1, 0],
    ][edge]
    const target = [x + ux * r * 2.5, y + uy * r * 2.5] // where it will be soon
    const crowded = world.hunters.some(o => Math.hypot(o.x - target[0], o.y - target[1]) < (world.radius(o) + r) * ENTRY_CLEARANCE / 2)
    const nearCorner = world.corners.some(c => Math.hypot(c[0] - target[0], c[1] - target[1]) < world.cfg.corners.range * r)
    if (!crowded && !nearCorner) best = { x, y, ux, uy }
  }
  if (!best) return false
  s.x = best.x
  s.y = best.y
  s.vx = best.ux * travel
  s.vy = best.uy * travel
  s.entering = { ux: best.ux, uy: best.uy, speed: travel, t0: world.t, fade: 0 }
  world.hunters.push(s)
  world.log('arrive', { id: s.id, mass: +s.mass.toFixed(2) })
  return true
}

/** One hunter leaves: the one closest to an edge (walls) or the smallest (wrapping). @returns {boolean} */
function sendAway (world, bodies) {
  const { travel, fade } = world.cfg.hunters.population
  const free = bodies.filter(s => !inTransit(s) && s.sickUntil === 0 && !s.anim)
  if (free.length === 0) return false

  if (world.cfg.wrap) {
    const s = free.reduce((a, b) => (b.mass < a.mass ? b : a))
    s.leaving = { ux: 0, uy: 0, speed: 0, t0: world.t, fade }
    s.hunt = null
    world.log('leave', { id: s.id, mass: +s.mass.toFixed(2) })
    return true
  }

  let choice = null
  for (const s of free) {
    // how far to the top, right, bottom and left edge, and the direction to walk to leave through it
    const gaps = [[s.y, 0, -1], [world.w - s.x, 1, 0], [world.h - s.y, 0, 1], [s.x, -1, 0]]
    for (const [gap, ux, uy] of gaps) if (!choice || gap < choice.gap) choice = { s, gap, ux, uy }
  }
  choice.s.leaving = { ux: choice.ux, uy: choice.uy, speed: travel, t0: world.t, fade: 0 }
  choice.s.hunt = null
  world.log('leave', { id: choice.s.id, mass: +choice.s.mass.toFixed(2) })
  return true
}

/**
 * Moves the hunters that are coming in or leaving along, and lets the ones that are done go: a walker
 * decides its own velocity here, a fader only has its opacity set. Call every step, after `integrate`.
 * @param {import('./world.mjs').World} world
 */
export function moveTransit (world) {
  const { w, h } = world
  for (const s of [...world.hunters]) {
    const move = s.entering || s.leaving
    if (!move || s.ghost) continue
    const r = world.radius(s)

    if (move.fade > 0) { // fading in or out
      const k = smootherstep((world.t - move.t0) / move.fade)
      s.alpha = s.entering ? k : 1 - k
      if (k >= 1) {
        if (s.entering) { s.entering = null; s.alpha = 1 } else world.hunters.splice(world.hunters.indexOf(s), 1)
      }
      continue
    }

    s.vx = move.ux * move.speed
    s.vy = move.uy * move.speed
    if (s.entering) {
      const m = SETTLED * r
      if (s.x >= m && s.x <= w - m && s.y >= m && s.y <= h - m) s.entering = null
    } else if (s.x + r < 0 || s.x - r > w || s.y + r < 0 || s.y - r > h) {
      world.hunters.splice(world.hunters.indexOf(s), 1)
    }
  }
}
