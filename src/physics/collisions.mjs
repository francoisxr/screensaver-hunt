// Collisions: hunters bounce off each other, and every new touch is a chance for the two to merge
// (a good chance when one has been hunting the other: it caught it).

import { inChase } from './stalking.mjs'

const MAX_PUSH = 0.7 // overlapping hunters are pushed apart by at most this much per step (units), so nobody is teleported out of the way
const RELEASE_DISTANCE = 1.15 // two hunters count as apart again once they are this far (in touching distances)

/** Whether a hunter is allowed to merge right now. */
export function canMerge (world, s) {
  return s.sickUntil === 0 && !s.anim && !s.ghost && !s.entering && !s.leaving && world.t >= s.immuneUntil
}

/**
 * Pushes overlapping hunters apart and exchanges momentum along the line between them. Each pair
 * that starts touching gets one roll of the dice for merging.
 * @param {import('./world.mjs').World} world
 * @param {import('./hunter.mjs').Hunter[]} bodies
 * @returns {[object, object][]} the pairs that decided to merge
 */
export function resolveCollisions (world, bodies) {
  const { repulsion, merging, hunting } = world.cfg
  const wantMerge = []
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const b = bodies[j]
      const touch = world.radius(a) + world.radius(b)
      const dx = world.dx(a.x - b.x)
      const dy = world.dy(a.y - b.y)
      const dist = Math.hypot(dx, dy)
      const key = a.id < b.id ? a.id + '-' + b.id : b.id + '-' + a.id
      if (dist >= touch) {
        if (dist > touch * RELEASE_DISTANCE) { world.contacts.delete(key); world.catchRolls.delete(key) }
        continue
      }
      if (!world.contacts.has(key)) { // a new touch
        world.contacts.add(key)
        if (canMerge(world, a) && canMerge(world, b)) {
          if (inChase(a, b)) {
            world.catchRolls.set(key, world.t)
            if (catchPrey(world, a, b)) wantMerge.push([a, b])
          } else if (world.rng.chance(merging.chance)) wantMerge.push([a, b])
        }
      } else if (inChase(a, b) && canMerge(world, a) && canMerge(world, b) && world.t - (world.catchRolls.get(key) ?? -Infinity) >= hunting.stalk.retry) {
        // a hunter that still holds its prey tries again (it would otherwise stay pinned against it)
        world.catchRolls.set(key, world.t)
        if (catchPrey(world, a, b)) wantMerge.push([a, b])
      }

      // Push apart, then bounce.
      const d = Math.max(dist, 1e-6)
      const nx = dx / d
      const ny = dy / d
      const overlap = Math.min(touch - d, MAX_PUSH)
      const wa = b.mass / (a.mass + b.mass)
      a.x += nx * overlap * wa; a.y += ny * overlap * wa
      b.x -= nx * overlap * (1 - wa); b.y -= ny * overlap * (1 - wa)
      world.wrapPoint(a)
      world.wrapPoint(b)
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (vn < 0) {
        const j2 = -(1 + repulsion.restitution) * vn / (1 / a.mass + 1 / b.mass)
        a.vx += j2 / a.mass * nx; a.vy += j2 / a.mass * ny
        b.vx -= j2 / b.mass * nx; b.vy -= j2 / b.mass * ny
      }
    }
  }
  return wantMerge
}

/**
 * A hunter reaches its prey: with `catchChance` it gets it (they merge); otherwise it bounces off, a good
 * distance, and has to get its breath back, while the prey gets a short boost to get away.
 * @returns {boolean} whether they merge
 */
function catchPrey (world, a, b) {
  const { stalk } = world.cfg.hunting
  if (world.rng.chance(stalk.catchChance)) return true
  const hunter = a.stalk?.target === b ? a : b
  const prey = hunter === a ? b : a
  const d = Math.max(world.distance(prey, hunter), 1e-6)
  const nx = world.dx(hunter.x - prey.x) / d // from the prey to the hunter
  const ny = world.dy(hunter.y - prey.y) / d
  const away = world.rng.range(stalk.bounce)
  hunter.vx = nx * away
  hunter.vy = ny * away
  hunter.recoilUntil = world.t + world.rng.range(stalk.recoil)
  const boost = world.rng.range(stalk.boost)
  prey.vx = -nx * boost
  prey.vy = -ny * boost
  prey.boostUntil = world.t + world.rng.range(stalk.boostSeconds)
  world.log('bounce', { hunter: hunter.id, prey: prey.id })
  return false
}

/** Forgets touches involving hunters that no longer exist. */
export function pruneContacts (world) {
  const alive = new Set(world.hunters.map(s => s.id))
  for (const key of world.contacts) {
    const [x, y] = key.split('-').map(Number)
    if (!alive.has(x) || !alive.has(y)) { world.contacts.delete(key); world.catchRolls.delete(key) }
  }
}
