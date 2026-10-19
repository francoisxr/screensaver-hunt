import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHunter } from '../src/physics/hunter.mjs'
import { pace } from '../src/physics/forces.mjs'
import { makeWorld, emptyWorld, run } from './helpers.mjs'

const few = { hunting: { stalk: { minHunters: 2 } }, motion: { wander: 0 } } // two hunters are enough for a chase in these tests
const place = (world, x, y, mass) => { const s = createHunter(world, x, y, mass); world.hunters.push(s); return s }
const merges = world => world.events.filter(e => e.type === 'merge').length

test('stalking: a hunter big enough hunts its closest neighbour; the neighbour knows it is hunted', () => {
  const world = emptyWorld(few)
  const big = place(world, 60, 22, 2)
  const small = place(world, 100, 22, 1)
  world.step(1 / 30)
  assert.equal(big.stalk?.target, small)
  assert.equal(small.threat?.from, big)
  assert.equal(small.stalk, null, 'the smaller one does not hunt the bigger')
  assert.equal(big.threat, null)
})

test('stalking: only the closest neighbour is hunted, and only when it is big enough smaller', () => {
  const world = emptyWorld(few)
  const big = place(world, 100, 22, 2)
  const near = place(world, 130, 22, 1)
  const far = place(world, 220, 22, 1)
  world.step(1 / 30)
  assert.equal(big.stalk?.target, near)
  assert.equal(far.threat, null)

  const close = emptyWorld(few)
  const a = place(close, 60, 22, 1.15) // only 1.15 times bigger: not enough (the ratio is 1.2)
  place(close, 100, 22, 1)
  close.step(1 / 30)
  assert.equal(a.stalk, null)
})

test('stalking: not while a hunter is sick or still merging, and not when there are too few hunters', () => {
  const sick = emptyWorld(few)
  const a = place(sick, 60, 22, 2)
  const b = place(sick, 100, 22, 1)
  b.sickUntil = 100
  sick.step(1 / 30)
  assert.equal(a.stalk, null)

  const lonely = emptyWorld({ motion: { wander: 0 }, hunting: { stalk: { minHunters: 5 } } }) // needs 5 hunters
  const c = place(lonely, 60, 22, 2)
  place(lonely, 100, 22, 1)
  lonely.step(1 / 30)
  assert.equal(c.stalk, null)
})

test('stalking: it can be switched off', () => {
  const world = emptyWorld({ ...few, hunting: { stalk: { minHunters: 2, drive: 0 } } })
  const big = place(world, 60, 22, 2)
  place(world, 100, 22, 1)
  world.step(1 / 30)
  assert.equal(big.stalk, null)
})

test('stalking: roles follow the masses, so a prey that grows bigger than its hunter turns the chase around', () => {
  const world = emptyWorld(few)
  const big = place(world, 60, 22, 1.6)
  const small = place(world, 100, 22, 1)
  world.step(1 / 30)
  assert.equal(big.stalk?.target, small)
  small.mass = 2.2 // it ate its way to the top
  world.step(1 / 30)
  assert.equal(small.stalk?.target, big)
  assert.equal(big.threat?.from, small)
  assert.equal(big.stalk, null)
})

test('stalking: the hunter always catches up, and the catch ends in a merge', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = emptyWorld(few, seed)
    const big = place(world, 40, 22, 1.6)
    const small = place(world, 120, 22, 1)
    let closest = Infinity
    run(world, 40, () => { if (!small.ghost) closest = Math.min(closest, Math.hypot(big.x - small.x, big.y - small.y)) })
    assert.ok(merges(world) >= 1, `seed ${seed}: no catch in 40 s`)
    assert.ok(closest < world.radius(big) + world.radius(small) + 1, `seed ${seed}: they touched`)
  }
})

test('stalking: the hunted one runs, but slower than the one chasing it', () => {
  const world = emptyWorld({ hunting: { stalk: { minHunters: 2, catchChance: 0 } }, merging: { chance: 0 }, motion: { wander: 0 } }, 3)
  const big = place(world, 40, 22, 1.6)
  const small = place(world, 90, 22, 1)
  let chaser = 0
  let runner = 0
  let n = 0
  run(world, 4, () => { if (Math.hypot(big.x - small.x, big.y - small.y) > 25) { chaser += Math.hypot(big.vx, big.vy); runner += Math.hypot(small.vx, small.vy); n++ } })
  assert.ok(n > 20)
  assert.ok(small.x > 90, 'it ran away from the hunter')
  assert.ok(runner / n > 3, 'and it did run')
  assert.ok(runner / n < chaser / n, `the runner (${(runner / n).toFixed(1)}) is slower than the chaser (${(chaser / n).toFixed(1)})`)
})

test('stalking: a catch merges (with the configured chance); an ordinary bounce keeps the ordinary chance', () => {
  const always = emptyWorld({ ...few, merging: { chance: 0 }, hunting: { stalk: { minHunters: 2, catchChance: 1 } } })
  place(always, 100, 22, 1.6)
  place(always, 104, 22, 1) // touching already
  run(always, 1)
  assert.ok(merges(always) >= 1, 'the catch merged')

  const never = emptyWorld({ ...few, merging: { chance: 1 }, hunting: { stalk: { minHunters: 2, drive: 0 } } })
  place(never, 100, 22, 1.6)
  place(never, 104, 22, 1)
  run(never, 1)
  assert.ok(merges(never) >= 1, 'without stalking the ordinary chance (here 1) applies')

  const refused = emptyWorld({ ...few, merging: { chance: 1 }, hunting: { stalk: { minHunters: 2, catchChance: 0 } } })
  place(refused, 100, 22, 1.6)
  place(refused, 104, 22, 1)
  run(refused, 0.2)
  assert.equal(merges(refused), 0, 'a catch with chance 0 does not merge, whatever the ordinary chance is')
})

test('a hunter that eats is sluggish for 3 to 5 seconds, and then has its pace back', () => {
  const world = emptyWorld({ motion: { wander: 0 } })
  const s = place(world, 100, 22, 1)
  world.cookies.push({ id: 900, x: 101, y: 22, born: 0 })
  run(world, 0.05)
  assert.ok(s.slow, 'it is slowed')
  const seconds = s.slow.until - s.slow.from
  assert.ok(seconds >= 3 && seconds <= 5, `${seconds} seconds`)
  run(world, 1)
  assert.ok(Math.abs(pace(world, s) - world.cfg.cookies.slowPace) < 0.05, `pace ${pace(world, s)}`)
  run(world, seconds + 0.5)
  assert.equal(pace(world, s), 1)
  assert.equal(s.slow, null)
})

test('a slowed hunter cannot reach the normal top speed', () => {
  const world = emptyWorld({ motion: { wander: 0, maxSpeed: 30, drag: 0 }, cookies: { slowPace: 0.4, slowSeconds: [4, 4] } })
  const slow = place(world, 40, 22, 1)
  const normal = place(world, 40, 40, 1)
  slow.slow = { from: 0, until: 100 }
  slow.vx = normal.vx = 25
  run(world, 0.5)
  const top = 30 * (0.5 + 0.5 * 0.4)
  assert.ok(Math.hypot(slow.vx, slow.vy) <= top + 1e-6, `${Math.hypot(slow.vx, slow.vy)} vs ${top}`)
  assert.ok(Math.hypot(normal.vx, normal.vy) > top)
})

test('movement: hunters wander and chase faster and more than before', () => {
  const world = makeWorld({}, 2)
  const { motion, hunting, kicks } = world.cfg
  assert.ok(motion.wander > 3 && motion.maxSpeed > 32 && hunting.speed > 20 && hunting.accel > 26 && kicks.speed[0] > 14)
})

test('a merge never leaves a follower with a negative size or opacity (the window sizes are square roots of them)', () => {
  for (const seed of [1, 2, 3, 4]) {
    const world = makeWorld({}, seed)
    run(world, 150, w => {
      for (const s of w.hunters) assert.ok(s.drawMass >= 0 && s.alpha >= 0 && Number.isFinite(s.x + s.y + s.drawMass), `seed ${seed}: ${JSON.stringify({ dm: s.drawMass, a: s.alpha })}`)
    })
  }
})

test('the screen does not empty out: with hunters hunting each other and new ones arriving there are still enough of them', () => {
  for (const seed of [1, 2, 3]) {
    const world = makeWorld({}, seed)
    let low = 0
    let total = 0
    let steps = 0
    run(world, 300, w => {
      if (steps++ % 30) return
      const n = w.hunters.filter(s => !s.ghost).length
      total += n
      if (n <= 2) low++
    })
    assert.ok(total / (steps / 30) >= 3.2, `seed ${seed}: ${(total / (steps / 30)).toFixed(1)} hunters on average`)
    assert.ok(low / (steps / 30) < 0.08, `seed ${seed}: only 1 or 2 hunters ${(100 * low / (steps / 30)).toFixed(0)}% of the time`)
  }
})

test('stalking: a hunter sticks with its prey when another hunter gets nearer, and lets go when the prey is far away or no longer a fair target', () => {
  const world = emptyWorld(few)
  const big = place(world, 60, 22, 2)
  const prey = place(world, 100, 22, 1)
  world.step(1 / 30)
  assert.equal(big.stalk?.target, prey)
  const bystander = place(world, 60, 36, 1) // now closer than the prey (and smaller too), but not touching
  world.step(1 / 30)
  assert.equal(big.stalk?.target, prey, 'it keeps going for the one it picked')
  world.hunters.splice(world.hunters.indexOf(bystander), 1)

  prey.x = big.x + world.cfg.hunting.stalk.range * 1.2 // a bit beyond the range, within the 1.4 it tolerates
  world.step(1 / 30)
  assert.equal(big.stalk?.target, prey, 'it holds on a while longer than it would start')
  prey.x = big.x + world.cfg.hunting.stalk.range * 1.6
  world.step(1 / 30)
  assert.equal(big.stalk, null, 'it lets go of a prey that got away')

  prey.x = big.x + 40
  world.step(1 / 30)
  assert.equal(big.stalk?.target, prey)
  prey.mass = 1.99 // it grew until it is as big as its hunter (a small gap is tolerated, so it takes a lot)
  world.step(1 / 30)
  assert.equal(big.stalk, null, 'and of one that is no longer a fair target')
})

test('stalking: picking a prey starts with a pounce, a burst of speed straight at it', () => {
  const world = emptyWorld(few)
  const big = place(world, 60, 22, 2)
  place(world, 100, 22, 1)
  world.step(1 / 30)
  const [lo] = world.cfg.hunting.stalk.pounce
  assert.ok(big.vx > lo - 2, `its speed after the first step is ${big.vx.toFixed(1)}`)
  assert.ok(Math.abs(big.vy) < 2, 'straight at the prey')
  const speed = big.vx
  world.step(1 / 30)
  assert.ok(big.vx < speed + 3, 'only once')
})

test('stalking: a chase is a chase: it lasts several seconds and ends with the hunter on its prey', () => {
  const world = emptyWorld({ wrap: true, motion: { wander: 0 }, hunting: { stalk: { minHunters: 0, catchChance: 1 } } }, 3)
  const big = place(world, 20, 22, 1.8)
  const prey = place(world, 120, 22, 1)
  let chaseSeconds = 0
  let fastest = 0
  run(world, 30, () => {
    if (big.stalk && !prey.ghost && !world.events.some(e => e.type === 'merge')) { chaseSeconds += 1 / 30; fastest = Math.max(fastest, Math.hypot(big.vx, big.vy)) }
  })
  assert.ok(world.events.some(e => e.type === 'merge'), 'it caught it')
  assert.ok(chaseSeconds > 3, `the chase lasted ${chaseSeconds.toFixed(1)} s`)
  assert.ok(fastest > 22, `at its fastest the chaser did ${fastest.toFixed(0)} units/s (it lunges above 22)`)
})
