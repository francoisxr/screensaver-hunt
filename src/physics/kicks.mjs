// Kicks: every 10-20 seconds one hunter gets a shove in a random direction, so the dishes keep
// moving across the screens. Hunters take turns in a shuffled order: nobody is kicked twice before
// everybody has been kicked once.

import { TAU } from '../core/math.mjs'

/**
 * Kicks the next hunter in the queue.
 * @param {import('./world.mjs').World} world
 * @returns {{ id: number, angle: number, speed: number } | null}
 */
export function kickNextHunter (world) {
  const bodies = world.bodies().filter(s => s.sickUntil === 0 && !s.anim && world.t >= s.calmUntil) // nobody lying low is shoved
  world.queue = world.queue.filter(id => bodies.some(s => s.id === id))
  if (world.queue.length === 0) world.queue = world.rng.shuffle(bodies.map(s => s.id))
  const id = world.queue.pop() // (taken once: popping inside the search would throw away a turn per hunter checked)
  const s = bodies.find(o => o.id === id)
  if (!s) return null
  const angle = world.rng.float(0, TAU)
  const speed = world.rng.range(world.cfg.kicks.speed)
  s.vx += Math.cos(angle) * speed
  s.vy += Math.sin(angle) * speed
  return { id: s.id, angle, speed }
}
