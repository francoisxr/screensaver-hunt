// Stalking: a hunter that is big enough to merge with its closest neighbour hunts it down, and the
// hunted one flees, but at a lower drive than the hunter chasing it, so the faster one always catches
// up. Nobody is fixed in a role: who hunts whom is decided again every step from the current masses,
// so a prey that eats enough cookies to become the larger one turns the chase around.
//
// Fleeing comes first, then stalking, then going for cookies (unless a cookie is much closer than the
// hunter being stalked).

import { canMerge } from './collisions.mjs'

const CHASE_GAIN = 3      // how sharply a chaser corrects its velocity toward its target
const LEAD = 0.5          // how far ahead of the target it aims, as a share of the time to reach it
const FOCUS = 0.8         // share of its random drift a stalking or fleeing hunter gives up
const STICK_RANGE = 1.4   // a hunter keeps its prey while it is closer than this many times the hunting range...
const STICK_RATIO = 0.85  // ...and it is still at least this share of the usual size advantage

/**
 * Decides who stalks whom: each merge-capable hunter looks at its closest neighbour and stalks it if it
 * is big enough compared with it. Sets `stalk` ({ target, d }) on the stalker and `threat` ({ from, d })
 * on the one being stalked (the closest of its stalkers, if there are several).
 * Call after `planHunts`, which says which cookie each hunter is after.
 * @param {import('./world.mjs').World} world
 * @param {import('./hunter.mjs').Hunter[]} bodies
 */
export function planStalks (world, bodies) {
  const { stalk } = world.cfg.hunting
  for (const s of bodies) { s.stalk = null; s.threat = null }
  if (stalk.drive <= 0 || bodies.length < stalk.minHunters) { for (const s of bodies) s.stalkId = 0; return } // with only a few left they leave each other alone

  for (const a of bodies) {
    const target = pickPrey(world, a, bodies, stalk)
    if (!target) { a.stalkId = 0; continue }
    const d = world.distance(a, target)
    if (a.stalkId !== target.id) { a.stalkId = target.id; a.pounce = true } // a new prey: pounce
    a.stalk = { target, d }
    if (!target.threat || d < target.threat.d) target.threat = { from: a, d }
  }
}

/**
 * Who `a` hunts: the prey it already has while that is still a fair target (it sticks with it, which is
 * what makes a chase last), otherwise its closest neighbour if it is big enough compared with it.
 * @returns {import('./hunter.mjs').Hunter | null}
 */
function pickPrey (world, a, bodies, stalk) {
  if (!canMerge(world, a) || world.t < a.digestUntil) return null

  const current = a.stalkId ? bodies.find(b => b.id === a.stalkId) : null
  if (current && canMerge(world, current) &&
      world.distance(a, current) <= stalk.range * STICK_RANGE && a.mass >= current.mass * stalk.ratio * STICK_RATIO) {
    return current
  }

  let near = null
  let nearest = Infinity
  for (const b of bodies) {
    if (b === a) continue
    const d = world.distance(a, b)
    if (d < nearest) { nearest = d; near = b }
  }
  if (!near || nearest > stalk.range || !canMerge(world, near)) return null
  if (a.mass < near.mass * stalk.ratio) return null
  if (a.prey && a.prey.d < nearest * stalk.cookieFirst) return null // a cookie much closer comes first
  return near
}

/** Whether two hunters are in a chase: one of them is stalking the other. */
export function inChase (a, b) {
  return a.stalk?.target === b || b.stalk?.target === a
}

/**
 * The steering of a fleeing or stalking hunter.
 * @returns {number | null} how much of its random drift it gives up, or null when it is neither
 *   (it then goes for cookies, see `huntSteer`)
 */
export function stalkSteer (world, s, world_dt) {
  const { hunting } = world.cfg
  const { stalk } = hunting

  if (s.threat && s.threat.d <= stalk.fleeRange) {
    const p = s.threat.from
    const d = Math.max(s.threat.d, 1e-6)
    let ux = world.dx(s.x - p.x) / d
    let uy = world.dy(s.y - p.y) / d
    // it runs for a cookie if one is near, a chance to grow and turn the tables
    let nearest = null
    let nd = stalk.cookieRange
    for (const c of world.cookies) {
      const cd = world.distance(s, c)
      if (cd < nd) { nd = cd; nearest = c }
    }
    if (nearest) {
      ux += stalk.cookieBias * world.dx(nearest.x - s.x) / Math.max(nd, 1e-6)
      uy += stalk.cookieBias * world.dy(nearest.y - s.y) / Math.max(nd, 1e-6)
      const len = Math.hypot(ux, uy) || 1
      ux /= len; uy /= len
    }
    const drive = stalk.fleeDrive * (world.t < s.boostUntil ? stalk.boostDrive : 1) // just bounced off its hunter: running for its life
    steer(world, s, ux, uy, drive)
    return FOCUS
  }

  if (s.stalk && world.t < s.recoilUntil) return FOCUS // thrown back by a failed catch: it gets its breath back

  if (s.stalk) {
    const t = s.stalk.target
    const d = Math.max(s.stalk.d, 1e-6)
    const want = hunting.speed * stalk.drive
    const ahead = LEAD * d / Math.max(want, 1)
    const dx = world.dx(t.x - s.x) + t.vx * ahead
    const dy = world.dy(t.y - s.y) + t.vy * ahead
    const len = Math.hypot(dx, dy) || 1
    if (s.pounce) { // the moment it picks its prey: a burst of speed straight at it
      s.pounce = false
      const burst = world.rng.range(stalk.pounce)
      s.vx += dx / len * burst
      s.vy += dy / len * burst
    }
    steer(world, s, dx / len, dy / len, stalk.drive)
    return FOCUS
  }
  return null
}

/** Accelerates toward the direction (ux, uy), up to the top speed and push of `drive`. */
function steer (world, s, ux, uy, drive) {
  const { hunting } = world.cfg
  const want = hunting.speed * drive
  let sx = (ux * want - s.vx) * CHASE_GAIN
  let sy = (uy * want - s.vy) * CHASE_GAIN
  const len = Math.hypot(sx, sy)
  const cap = hunting.accel * drive
  if (len > cap) { sx *= cap / len; sy *= cap / len }
  s.ax += sx
  s.ay += sy
}
