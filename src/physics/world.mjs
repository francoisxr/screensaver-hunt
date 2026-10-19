// The world: hunters (the dishes) and cookies drifting in the combined area of all screens.
//
// Hunters wander, push each other and the screen corners away, stay inside the area, and hunt cookies
// like predators. When two bounce they may merge; a merged hunter that grows too big gets sick, then
// splits. Every 10-20 seconds one of them gets kicked in a random direction. See the modules next to
// this one for each behaviour; this file only keeps the state and calls them in order.
//
// Units: 1 unit is the height of one terminal row (columns are converted with the character aspect
// ratio so circles stay round). Mass: 1 is the base hunter; its radius is r0 * sqrt(mass).
//
// The world knows nothing about drawing. A renderer reads `hunters` (with the drawing fields
// ox, oy, drawMass, alpha, fuzz), `cookies` and `links`.

import { createRng } from '../core/rng.mjs'
import { placeHunters } from './hunter.mjs'
import { startStep, applyRepulsion, applyBodyForces, integrate } from './forces.mjs'
import { planHunts } from './hunting.mjs'
import { planStalks } from './stalking.mjs'
import { resolveCollisions } from './collisions.mjs'
import { startMerge } from './merging.mjs'
import { startSplit } from './splitting.mjs'
import { updateCookies, maybeSpawnCookie } from './cookies.mjs'
import { kickNextHunter } from './kicks.mjs'
import { managePopulation, moveTransit } from './population.mjs'
import { updateAnimations, relaxVisuals } from './animations.mjs'

const MAX_LOGGED_EVENTS = 500
const R0_EASE = 4 // per second: how fast the size of the hunters follows a change of layout

export class World {
  /**
   * @param {typeof import('../config/defaults.mjs').DEFAULTS.physics} config the `physics` settings
   * @param {{ rng?: import('../core/rng.mjs').Rng }} [options] pass a seeded Rng for a repeatable run
   */
  constructor (config, { rng = createRng() } = {}) {
    this.cfg = config
    this.rng = rng
    /** @type {import('./hunter.mjs').Hunter[]} */
    this.hunters = []
    /** @type {{id: number, x: number, y: number, born: number}[]} */
    this.cookies = []
    /** Groups of hunters joined by a slime neck: { ids, thr } (a higher thr means a thinner neck). */
    this.links = []
    this.contacts = new Set() // pairs currently touching: a bounce is counted once per touch
    this.catchRolls = new Map() // when a hunter in contact with its prey last tried to merge with it, by pair
    this.queue = []           // shuffled order for the kicks
    this.events = []          // recent merge / split / sick / eat events, for logs and tests
    this.onEvent = null       // optional callback for every event
    this.t = 0                // simulation time, seconds
    this.w = 0                // width of the area, units
    this.h = 0                // height of the area, units
    this.r0 = 1               // radius of a hunter of mass 1, units (eases toward r0Target when the layout changes)
    this.r0Target = 1
    this.corners = []         // points hunters keep away from
    this.nextId = 1
    this.nextBoost = rng.range(config.kicks.every)
    this.nextCookie = 0.5
    this.populationTimer = 0  // seconds until the population is looked at again
  }

  /** A horizontal distance (b.x - a.x), the short way round when the world wraps. */
  dx (d) { return this.cfg.wrap && this.w > 0 ? d - this.w * Math.round(d / this.w) : d }

  /** A vertical distance (b.y - a.y), the short way round when the world wraps. */
  dy (d) { return this.cfg.wrap && this.h > 0 ? d - this.h * Math.round(d / this.h) : d }

  /** The distance between two things, the short way round when the world wraps. */
  distance (a, b) { return Math.hypot(this.dx(b.x - a.x), this.dy(b.y - a.y)) }

  /** Brings a point that left through one edge back in through the opposite one (when the world wraps). */
  wrapPoint (p) {
    if (!this.cfg.wrap || this.w <= 0 || this.h <= 0) return
    p.x = ((p.x % this.w) + this.w) % this.w
    p.y = ((p.y % this.h) + this.h) % this.h
  }

  /** The radius of a hunter, in units. */
  radius (s) { return this.r0 * Math.sqrt(s.mass) }

  /** The hunters that move on their own (not the followers of a merge or split). */
  bodies () { return this.hunters.filter(s => !s.ghost) }

  /** Records an event. */
  log (type, data) {
    const event = { t: +this.t.toFixed(1), type, ...data }
    this.events.push(event)
    if (this.events.length > MAX_LOGGED_EVENTS) this.events.shift()
    if (this.onEvent) this.onEvent(event)
  }

  /**
   * Describes the space. The hunters are placed on the first call; later calls (a window was resized)
   * only change the space.
   * @param {number} w width, units
   * @param {number} h height, units
   * @param {number} r0 radius of a mass-1 hunter, units
   * @param {[number, number][]} corners points hunters keep away from
   * @param {[number, number][]} [centres] the centre of each screen
   */
  setSpace (w, h, r0, corners, centres = []) {
    if (this.hunters.length > 0 && this.w > 0 && this.h > 0 && (w !== this.w || h !== this.h)) {
      // The area changed under living hunters (a window was resized, the character shape was measured):
      // everything keeps its place in it, instead of staying behind at the same coordinates.
      const sx = w / this.w
      const sy = h / this.h
      for (const s of this.hunters) { s.x *= sx; s.y *= sy; s.vx *= sx; s.vy *= sy }
      for (const c of this.cookies) { c.x *= sx; c.y *= sy }
    }
    this.w = w
    this.h = h
    this.r0Target = r0
    if (this.hunters.length === 0) this.r0 = r0 // (with living hunters the size eases there, see `step`)
    this.centres = centres      // the centre of each screen (a sick hunter drifts to the nearest one)
    this.corners = this.cfg.wrap ? [] : corners // with no walls there are no corners to keep away from
    if (this.hunters.length === 0) placeHunters(this)
  }

  /** Advances the simulation by dt seconds. */
  step (dt) {
    if (this.hunters.length === 0) return
    this.t += dt
    this.r0 += (this.r0Target - this.r0) * Math.min(1, R0_EASE * dt)
    const bodies = this.bodies()

    startStep(this, bodies, dt)
    planHunts(this, bodies)
    planStalks(this, bodies)
    applyRepulsion(this, bodies)
    applyBodyForces(this, bodies, dt)
    integrate(this, bodies, dt)
    moveTransit(this)
    managePopulation(this, bodies, dt)

    // Each new touch is a chance to merge; a pair is only used once per step.
    const used = new Set()
    for (const [a, b] of resolveCollisions(this, bodies)) {
      if (used.has(a.id) || used.has(b.id)) continue
      used.add(a.id)
      used.add(b.id)
      startMerge(this, a, b)
    }

    // Sick hunters start to split when their time is up.
    for (const s of bodies) {
      if (s.sickUntil !== 0 && !s.anim && this.t >= s.sickUntil) startSplit(this, s)
    }

    updateCookies(this, bodies)
    maybeSpawnCookie(this, dt)

    // One hunter at a time gets kicked, at random intervals.
    this.nextBoost -= dt
    if (this.nextBoost <= 0) {
      kickNextHunter(this)
      this.nextBoost = this.rng.range(this.cfg.kicks.every)
    }

    updateAnimations(this)
    relaxVisuals(this, dt)
  }
}
