import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHunter } from '../src/physics/hunter.mjs'
import { emptyWorld, run } from './helpers.mjs'

const setup = (seed, patch = {}) => {
  const world = emptyWorld({ motion: { wander: 0 }, hunting: { stalk: { minHunters: 0 } }, ...patch }, seed)
  const hunter = createHunter(world, 100, 22, 1.8)
  const prey = createHunter(world, 100 + 9.2, 22, 1) // touching (radii 6.1 + 4.6 would overlap: they are about to touch)
  world.hunters.push(hunter, prey)
  return { world, hunter, prey }
}
const outcome = world => (world.events.some(e => e.type === 'merge') ? 'merge' : world.events.some(e => e.type === 'bounce') ? 'bounce' : 'none')

test('catch: a hunter reaching its prey merges with it 30% of the time and bounces off 70% of the time', () => {
  const counts = { merge: 0, bounce: 0, none: 0 }
  for (let seed = 1; seed <= 300; seed++) {
    const { world } = setup(seed)
    run(world, 0.1)
    counts[outcome(world)]++
  }
  assert.equal(counts.none, 0, 'every catch had an outcome')
  assert.ok(counts.merge > 60 && counts.merge < 120, `${counts.merge} merges of 300`)
  assert.ok(counts.bounce > 180 && counts.bounce < 240, `${counts.bounce} bounces of 300`)
})

test('catch: after a bounce the hunter is thrown a good distance back and does not chase for a moment', () => {
  let tested = 0
  for (let seed = 1; seed <= 40 && tested < 5; seed++) {
    const { world, hunter, prey } = setup(seed)
    run(world, 0.05)
    if (outcome(world) !== 'bounce') continue
    tested++
    const d0 = world.distance(hunter, prey)
    assert.ok(hunter.recoilUntil > world.t, 'it is recoiling')
    run(world, 0.8)
    assert.ok(world.distance(hunter, prey) > d0 + 8, `it is ${world.distance(hunter, prey).toFixed(1)} away`)
    assert.ok(hunter.x < 100, 'and it went away from the prey, not after it')
  }
  assert.ok(tested >= 3)
})

test('catch: the prey gets a short boost: for a moment it runs harder than its hunter, then the hunter catches up again', () => {
  let tested = 0
  for (let seed = 1; seed <= 40 && tested < 4; seed++) {
    const { world, hunter, prey } = setup(seed)
    run(world, 0.05)
    if (outcome(world) !== 'bounce') continue
    tested++
    assert.ok(prey.boostUntil > world.t + 0.9, 'it is boosted for a second or more')
    const speed0 = Math.hypot(prey.vx, prey.vy)
    assert.ok(speed0 >= 14, `it is thrown away at ${speed0.toFixed(1)}`)
    assert.ok(prey.vx > 0, 'away from the hunter')
    let farthest = 0
    run(world, 12, () => { farthest = Math.max(farthest, world.distance(hunter, prey)) })
    assert.ok(farthest > 20, `it got ${farthest.toFixed(0)} away`)
    assert.ok(world.events.some(e => e.type === 'merge') || world.distance(hunter, prey) < 30, 'but the hunter is on it again (or has it)')
  }
  assert.ok(tested >= 2)
})

test('catch: the hunter always catches up with its prey, again and again, and gets it in the end', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const world = emptyWorld({ wrap: true, motion: { wander: 0 }, hunting: { stalk: { minHunters: 0 } } }, seed)
    world.hunters.push(createHunter(world, 40, 22, 1.8), createHunter(world, 120, 22, 1))
    run(world, 40)
    const catches = world.events.filter(e => e.type === 'bounce' || e.type === 'merge').length
    assert.ok(catches >= 2 || world.events.some(e => e.type === 'merge'), `seed ${seed}: only ${catches} catches in 40 s`)
    run(world, 200)
    assert.ok(world.events.some(e => e.type === 'merge'), `seed ${seed}: no merge in four minutes`)
  }
})
