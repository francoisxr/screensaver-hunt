// Cookies: food that appears at random (up to 5 at a time). A hunter that touches one eats it and gains
// a little mass; uneaten cookies spoil after a while.

const EAT_RADIUS = 0.9         // a hunter eats a cookie that comes within this share of its radius (plus the cookie's size)
const MARGIN_X = 2             // cookies keep this far from the left and right edges (units)...
const MARGIN_Y = 1.5           // ...and from the top and bottom
const REACHABLE = 1.3          // hunters are pushed from the corners, so cookies closer than this many r0 to one could never be reached
const NEAR_DISTANCE = [1.15, 2.2] // a "near" cookie appears this many radii from its hunter
const SPAWN_TRIES = 60

/** Eats the cookies hunters touch, and lets old ones spoil. */
export function updateCookies (world, bodies) {
  const { cookies, sickness } = world.cfg
  world.cookies = world.cookies.filter(c => world.t - c.born < cookies.life)
  for (const c of [...world.cookies]) {
    const eater = bodies.find(s => !s.entering && !s.leaving && Math.hypot(world.dx(s.x - c.x), world.dy(s.y - c.y)) <= world.radius(s) * EAT_RADIUS + cookies.radius)
    if (!eater) continue
    eater.mass += cookies.mass
    eater.fullUntil = world.t + world.rng.range(world.cfg.hunting.fullSeconds)
    eater.slow = { from: world.t, until: world.t + world.rng.range(cookies.slowSeconds) } // sluggish for a few seconds
    eater.hunt = null
    world.cookies.splice(world.cookies.indexOf(c), 1)
    world.log('eat', { id: eater.id, mass: +eater.mass.toFixed(2) })
    if (sickness.fromCookies && eater.mass > sickness.mass && eater.sickUntil === 0 && !eater.anim) {
      eater.sickUntil = world.t + sickness.seconds
      eater.kickIn = 0
      world.log('sick', { id: eater.id, mass: +eater.mass.toFixed(2), cause: 'cookie' })
    }
  }
}

/** Counts down to the next cookie and spawns it when there is room. */
export function maybeSpawnCookie (world, dt) {
  const { cookies } = world.cfg
  world.nextCookie -= dt
  if (world.cookies.length < cookies.max && world.nextCookie <= 0) {
    spawnCookie(world)
    world.nextCookie = world.rng.range(cookies.every)
  }
}

/** Puts a cookie somewhere reachable: anywhere, or (often) a little way out from a random hunter. */
export function spawnCookie (world) {
  const { rng, w, h } = world
  let best = null
  const bodies = world.bodies()
  const near = bodies.length > 0 && rng.chance(world.cfg.cookies.near)
  const host = near ? bodies[rng.int(bodies.length)] : null
  for (let tries = 0; tries < SPAWN_TRIES; tries++) {
    let x = rng.float(MARGIN_X, w - MARGIN_X)
    let y = rng.float(MARGIN_Y, h - MARGIN_Y)
    if (host) {
      const a = rng.float(0, 2 * Math.PI)
      const d = world.radius(host) * rng.range(NEAR_DISTANCE)
      x = Math.min(w - MARGIN_X, Math.max(MARGIN_X, host.x + Math.cos(a) * d))
      y = Math.min(h - MARGIN_Y, Math.max(MARGIN_Y, host.y + Math.sin(a) * d))
    }
    if (!world.corners.every(c => Math.hypot(c[0] - x, c[1] - y) > REACHABLE * world.r0)) continue
    if (!best) best = { x, y }
    if (bodies.every(s => Math.hypot(world.dx(s.x - x), world.dy(s.y - y)) > world.radius(s))) { best = { x, y }; break } // not inside a hunter
  }
  if (best) {
    const cookie = { id: world.nextId++, x: best.x, y: best.y, born: world.t }
    world.wrapPoint(cookie)
    world.cookies.push(cookie)
  }
}
