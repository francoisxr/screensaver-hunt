// Hunting: the hunters are predators. A hunter that spots a cookie freezes for a moment to take aim,
// pounces (an instant burst of speed), then steers hard at it. The hunter closest to a cookie leads
// the hunt; a few rivals race it with less drive. A hunter that has just eaten is full and only
// half-hearted about the next cookie, so the food gets shared around.

const AIM_DRAG = 4        // how strongly a hunter freezes while taking aim (per second)
const STEER_GAIN = 3      // how sharply it corrects its velocity toward the cookie
const FOCUS_AIMING = 0.9  // share of its random drift a hunter gives up while taking aim...
const FOCUS_CHASING = 0.75 // ...and while chasing
const REACT_BASE = 0.4    // a hunter reacts after react * (REACT_BASE + distance / sense): far cookies are noticed later
const RANK_BIAS = 5       // distance offset when choosing between offers, so a very close cookie does not dominate

/**
 * Decides who hunts which cookie. For every cookie the closest hunters (the leader and its rivals) are
 * offered it; each hunter goes for the offer with the best drive per distance.
 * Sets `prey` (this step's target) and `hunt` (the chase in progress) on every hunter.
 * @param {import('./world.mjs').World} world
 * @param {import('./hunter.mjs').Hunter[]} bodies
 */
export function planHunts (world, bodies) {
  const { hunting } = world.cfg
  for (const s of bodies) s.prey = null
  if (hunting.accel <= 0) return

  const hunters = bodies.filter(s => s.sickUntil === 0 && !s.anim && !s.entering && !s.leaving)
  const offers = new Map() // hunter id -> [{ c, drive, d }]
  for (const c of world.cookies) {
    const ranked = hunters
      .map(s => ({ s, d: Math.hypot(world.dx(c.x - s.x), world.dy(c.y - s.y)) }))
      .filter(o => o.d < hunting.sense)
      .sort((x, y) => x.d - y.d)
      .slice(0, 1 + hunting.rivals)
    ranked.forEach((o, rank) => {
      const full = world.t < o.s.fullUntil ? hunting.fullDrive : 1
      const drive = (rank === 0 ? 1 : hunting.rivalDrive) * full
      const list = offers.get(o.s.id) || []
      list.push({ c, drive, d: o.d })
      offers.set(o.s.id, list)
    })
  }

  for (const s of hunters) {
    const list = offers.get(s.id)
    if (!list) { s.hunt = null; continue }
    list.sort((x, y) => y.drive / (y.d + RANK_BIAS) - x.drive / (x.d + RANK_BIAS))
    const best = list[0]
    s.prey = best
    if (!s.hunt || s.hunt.cookie !== best.c.id) { // a new target: spot it, take aim, then pounce
      s.hunt = {
        cookie: best.c.id,
        t0: world.t,
        react: world.rng.range(hunting.react) * (REACT_BASE + best.d / hunting.sense),
        burst: false,
      }
    }
  }
  for (const s of bodies) if (!s.prey) s.hunt = null
}

/**
 * The steering of a hunting hunter: freeze and take aim, pounce, then steer hard at the cookie.
 * @returns {number} how much of its random drift the hunter gives up (0 when it is not hunting)
 */
export function huntSteer (world, s, dt) {
  if (!s.prey) return 0
  const { hunting } = world.cfg
  const { c, drive, d } = s.prey
  const ux = world.dx(c.x - s.x) / Math.max(d, 1e-6)
  const uy = world.dy(c.y - s.y) / Math.max(d, 1e-6)
  const hunt = s.hunt

  if (world.t - hunt.t0 < hunt.react) { // taking aim: freeze
    s.vx *= Math.exp(-AIM_DRAG * dt)
    s.vy *= Math.exp(-AIM_DRAG * dt)
    return FOCUS_AIMING
  }

  if (!hunt.burst) { // the pounce
    hunt.burst = true
    const burst = world.rng.range(hunting.burst) * drive
    s.vx += ux * burst
    s.vy += uy * burst
  }
  const want = hunting.speed * drive
  let sx = (ux * want - s.vx) * STEER_GAIN
  let sy = (uy * want - s.vy) * STEER_GAIN
  const len = Math.hypot(sx, sy)
  const cap = hunting.accel * drive
  if (len > cap) { sx *= cap / len; sy *= cap / len }
  s.ax += sx
  s.ay += sy
  return FOCUS_CHASING
}
