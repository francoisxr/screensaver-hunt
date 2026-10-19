// The forces on the hunters and the integration of their motion. Each function does one thing to
// the hunters' accelerations (ax, ay) or velocities; `World.step` calls them in a fixed order.

import { TAU } from '../core/math.mjs'
import { huntSteer } from './hunting.mjs'
import { stalkSteer } from './stalking.mjs'
import { walking } from './population.mjs'
import { clamp01, smootherstep } from '../core/math.mjs'

const MIN_MASS_FOR_PUSH = 0.3  // light hunters are not shoved around more than a 0.3-mass one would be
const WALL_BOUNCE = 0.4        // share of its speed a hunter keeps when it bounces off the hard wall
const JOLT_THRESHOLD = 0.1     // agitation above which a hunter gets random jolts

/** Clears the accelerations and moves every hunter's agitation toward its sickness. */
export function startStep (world, bodies, dt) {
  const { sickness } = world.cfg
  for (const s of bodies) {
    s.ax = 0
    s.ay = 0
    const target = s.sickUntil !== 0 ? 1 : 0
    const rate = target > s.agit ? sickness.agitationUp : sickness.agitationDown
    s.agit += (target - s.agit) * Math.min(1, rate * dt)
  }
}

/** Hunters push each other apart, softly, before they touch. */
export function applyRepulsion (world, bodies) {
  const { repulsion } = world.cfg
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const b = bodies[j]
      let dx = world.dx(a.x - b.x)
      let dy = world.dy(a.y - b.y)
      let dist = Math.hypot(dx, dy)
      const touch = world.radius(a) + world.radius(b)
      const reach = touch * repulsion.range
      if (dist >= reach) continue
      if (dist < 1e-6) { dx = world.rng.random() - 0.5; dy = world.rng.random() - 0.5; dist = Math.hypot(dx, dy) }
      const f = repulsion.strength * ((reach - dist) / reach) ** 2
      const ux = dx / dist
      const uy = dy / dist
      a.ax += ux * f / Math.max(MIN_MASS_FOR_PUSH, a.mass); a.ay += uy * f / Math.max(MIN_MASS_FOR_PUSH, a.mass)
      b.ax -= ux * f / Math.max(MIN_MASS_FOR_PUSH, b.mass); b.ay -= uy * f / Math.max(MIN_MASS_FOR_PUSH, b.mass)
    }
  }
}

/** Every screen corner pushes the hunter away. */
export function applyCorners (world, s) {
  const { corners } = world.cfg
  const reach = corners.range * world.radius(s)
  for (const c of world.corners) {
    const dx = s.x - c[0]
    const dy = s.y - c[1]
    const dist = Math.hypot(dx, dy)
    if (dist >= reach || dist < 1e-6) continue
    const f = corners.strength * ((reach - dist) / reach) ** 2
    s.ax += dx / dist * f
    s.ay += dy / dist * f
  }
}

/** A spring pushes the hunter back when it gets close to the edge of the area. */
export function applyWalls (world, s) {
  const { walls } = world.cfg
  const { w, h } = world
  const m = walls.soft * world.radius(s)
  if (s.x < m) s.ax += walls.spring * (m - s.x)
  if (s.x > w - m) s.ax -= walls.spring * (s.x - (w - m))
  if (s.y < m) s.ay += walls.spring * (m - s.y)
  if (s.y > h - m) s.ay -= walls.spring * (s.y - (h - m))
}

/**
 * A slow random drift: a heading that turns by itself, frantic while sick, mostly given up while hunting.
 * @param {number} focus how much of the drift a hunting hunter gives up (0..1)
 */
export function applyWander (world, s, dt, focus) {
  const { motion, sickness } = world.cfg
  s.ang += world.rng.gauss() * motion.wanderTurn * (1 + 3 * s.agit) * Math.sqrt(dt)
  const drift = motion.wander * (1 + (sickness.wander - 1) * s.agit) * (1 - focus)
  s.ax += Math.cos(s.ang) * drift
  s.ay += Math.sin(s.ang) * drift
}

/** Sick hunters also get sudden random jolts. */
export function applyJolts (world, s, dt) {
  if (s.agit <= JOLT_THRESHOLD) return
  const { jolts } = world.cfg.sickness
  s.kickIn -= dt
  if (s.kickIn > 0) return
  const a = world.rng.float(0, TAU)
  const v = world.rng.range(jolts.speed) * s.agit
  s.vx += Math.cos(a) * v
  s.vy += Math.sin(a) * v
  s.kickIn = world.rng.range(jolts.every)
}

const SLOW_IN = 0.25   // seconds a hunter takes to slow down after eating...
const SLOW_OUT = 1.0   // ...and to get its pace back at the end

/**
 * How much of its normal pace a hunter has right now: 1, or less for a while after it ate a cookie
 * (it eases down quickly and back up slowly).
 */
export function pace (world, s) {
  if (!s.slow) return 1
  const k = Math.min(smootherstep((world.t - s.slow.from) / SLOW_IN), smootherstep((s.slow.until - world.t) / SLOW_OUT))
  if (world.t >= s.slow.until) { s.slow = null; return 1 }
  return 1 - (1 - world.cfg.cookies.slowPace) * clamp01(k)
}

/**
 * A sick (or bursting) hunter drifts slowly to the centre of the screen nearest to it, so the burst happens
 * where it can be seen and not in a corner. It slows down on arrival.
 */
export function applyCentring (world, s) {
  const { centring } = world.cfg.sickness
  let best = null
  let nearest = Infinity
  for (const c of world.centres ?? []) {
    const d = Math.hypot(world.dx(c[0] - s.x), world.dy(c[1] - s.y))
    if (d < nearest) { nearest = d; best = c }
  }
  if (!best || nearest < 1e-6) return
  const speed = Math.min(centring.speed, nearest * centring.pull) // the speed it drifts at: slower the closer it gets
  const drag = world.cfg.motion.drag + world.cfg.splitting.drag
  const a = Math.min(centring.accel, speed * drag) // enough push to hold that speed against the braking
  s.ax += world.dx(best[0] - s.x) / nearest * a
  s.ay += world.dy(best[1] - s.y) / nearest * a
}

/** Whether a hunter is in the middle of bursting into pieces (see splitting.mjs). */
export const exploding = s => s.anim?.type === 'split'

/**
 * Whether a hunter is lying low: sick (about to burst), bursting, or just after the burst. It brakes hard, does not
 * hunt, flee or wander, and is left alone (see `canMerge`), so it is easy to follow.
 */
export const calm = (world, s) => s.sickUntil !== 0 || exploding(s) || world.t < s.calmUntil

/** All the per-hunter forces, in the order they are applied. */
export function applyBodyForces (world, bodies, dt) {
  for (const s of bodies) {
    if (walking(s)) continue // walking in or out: moveTransit decides its velocity
    if (!world.cfg.wrap) {
      applyCorners(world, s)
      applyWalls(world, s)
    }
    if (s.sickUntil !== 0 || exploding(s)) applyCentring(world, s)
    if (calm(world, s)) continue // sick, bursting or just burst: no hunting, fleeing, wandering or jolts, just the walls
    const ax0 = s.ax
    const ay0 = s.ay
    let focus = stalkSteer(world, s, dt)
    if (focus === null) focus = huntSteer(world, s, dt)
    applyWander(world, s, dt, focus)
    applyJolts(world, s, dt)
    const k = pace(world, s) // a hunter that just ate is sluggish: its own drive is weaker, the walls still push
    s.ax = ax0 + (s.ax - ax0) * k
    s.ay = ay0 + (s.ay - ay0) * k
  }
}

/** Accelerates, limits the speed, moves, and bounces off the hard wall. */
export function integrate (world, bodies, dt) {
  const { motion, walls } = world.cfg
  const { w, h } = world
  const { cookies } = world.cfg
  for (const s of bodies) {
    const k = pace(world, s)
    const drag = motion.drag + cookies.slowDrag * (1 - k) + (calm(world, s) ? world.cfg.splitting.drag : 0) // a slowed hunter also loses speed faster; a sick or bursting one nearly stops
    const damp = Math.exp(-drag * dt)
    s.vx = (s.vx + s.ax * dt) * damp
    s.vy = (s.vy + s.ay * dt) * damp
    const top = motion.maxSpeed * (0.5 + 0.5 * k)
    const speed = Math.hypot(s.vx, s.vy)
    if (speed > top) { s.vx *= top / speed; s.vy *= top / speed }
    s.x += s.vx * dt
    s.y += s.vy * dt
    if (world.cfg.wrap) { world.wrapPoint(s); continue } // no walls: out one side, in the other

    if (walking(s)) continue

    // Hard limit: bounce softly off the wall instead of leaving the area.
    const hx = walls.hard * world.radius(s)
    if (s.x < hx) { s.x = hx; s.vx = Math.abs(s.vx) * WALL_BOUNCE }
    if (s.x > w - hx) { s.x = w - hx; s.vx = -Math.abs(s.vx) * WALL_BOUNCE }
    if (s.y < hx) { s.y = hx; s.vy = Math.abs(s.vy) * WALL_BOUNCE }
    if (s.y > h - hx) { s.y = h - hx; s.vy = -Math.abs(s.vy) * WALL_BOUNCE }
  }
}
