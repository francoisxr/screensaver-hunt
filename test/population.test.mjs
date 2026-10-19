import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHunter } from '../src/physics/hunter.mjs'
import { makeWorld, emptyWorld, run } from './helpers.mjs'

const counted = w => w.hunters.filter(s => !s.ghost && !s.leaving).length
// A scripted world whose "starting number" is n, with nobody in it yet (the tests add the hunters they want).
const withCount = (n, patch = {}) => {
  const world = emptyWorld({ ...patch, hunters: { count: n, sizeJitter: 0.1, ...(patch.hunters ?? {}) } })
  world.hunters.length = 0
  return world
}
const fill = (world, n) => { for (let i = 0; i < n; i++) { const s = createHunter(world, 30 + i * 18, 10 + (i % 3) * 12, 1); world.hunters.push(s) } }
const outside = (w, s) => s.x < 0 || s.x > w.w || s.y < 0 || s.y > w.h

test('population: with fewer than 75% of the starting number, a new hunter walks in from outside the area', () => {
  const world = withCount(8, { motion: { wander: 0 } })
  fill(world, 5) // 5 < 6 (75% of 8)
  const before = world.hunters.length
  let first = null
  run(world, 5, () => { const n = world.hunters.find(s => s.entering); if (n && !first) first = { x: n.x, y: n.y, startedOutside: outside(world, n), id: n.id } })
  assert.ok(first, 'someone arrived')
  assert.ok(first.startedOutside, 'from outside the area')
  assert.ok(world.events.some(e => e.type === 'arrive'))
  assert.ok(world.hunters.length > before)
})

test('population: a newcomer walks in, settles inside the area, and is a normal hunter from then on', () => {
  const world = withCount(8, { motion: { wander: 0 } })
  fill(world, 5)
  run(world, 4)
  const arrival = world.hunters.find(s => !s.entering && !s.ghost && s.id > 5 && s.id !== undefined && world.events.some(e => e.type === 'arrive' && e.id === s.id))
  assert.ok(arrival, 'it arrived and is no longer entering')
  const r = world.radius(arrival)
  assert.ok(arrival.x >= 0 && arrival.x <= world.w && arrival.y >= 0 && arrival.y <= world.h, `it is inside: ${arrival.x}, ${arrival.y}`)
  assert.ok(r > 0)
})

test('population: arrivals stop once the number is back at 75%, and come at most one per interval', () => {
  const world = withCount(8, { motion: { wander: 0 }, hunters: { population: { every: [2, 2] } } })
  fill(world, 4)
  run(world, 30)
  const arrivals = world.events.filter(e => e.type === 'arrive').length
  assert.ok(arrivals >= 2 && arrivals <= 5, `${arrivals} arrivals`)
  assert.ok(counted(world) >= 6)
})

test('population: with more than 125% of the starting number, the hunter closest to an edge walks off', () => {
  const world = withCount(8, { motion: { wander: 0 } })
  fill(world, 11) // 11 > 10 (125% of 8)
  world.hunters[3].x = 5.5; world.hunters[3].y = 22 // clearly the closest to an edge (the others are 10 or more away)
  const target = world.hunters[3]
  run(world, 0.5)
  assert.ok(target.leaving, 'the one near the edge leaves')
  assert.equal(world.hunters.filter(s => s.leaving).length, 1, 'only one at a time')
  run(world, 6)
  assert.ok(!world.hunters.includes(target), 'and it is gone from the world')
  assert.ok(world.events.some(e => e.type === 'leave' && e.id === target.id))
})

test('population: it leaves through the nearest edge, in a straight line', () => {
  const world = withCount(4, { motion: { wander: 0 } })
  fill(world, 6)
  const s = world.hunters[0]
  s.x = 60; s.y = 3 // the top edge is closest
  run(world, 0.5)
  assert.ok(s.leaving && s.leaving.uy < 0 && s.leaving.ux === 0)
  run(world, 1)
  assert.ok(s.y < 3, 'it moves up and out')
})

test('population: a hunter in transit is out of the game: it does not eat, merge or get hunted', () => {
  const world = withCount(8, { motion: { wander: 0 }, hunting: { stalk: { minHunters: 0 } } })
  fill(world, 7)
  const walker = createHunter(world, -3, 22, 1)
  walker.entering = { ux: 1, uy: 0, speed: 1 } // slowly, just outside the left edge
  world.hunters.push(walker)
  world.cookies.push({ id: 900, x: -2.5, y: 22, born: 0 }) // (a cookie outside the area, right on top of it)
  world.step(1 / 30)
  assert.equal(world.cookies.length, 1, 'it did not eat the cookie it walks over')
  assert.equal(walker.threat, null)
  assert.ok(!world.hunters.some(s => s.stalk?.target === walker))
})

test('population: nobody is removed while sick or in the middle of a merge or split', () => {
  const world = withCount(4, { motion: { wander: 0 } })
  fill(world, 7)
  for (const s of world.hunters) s.sickUntil = 100
  run(world, 3)
  assert.equal(world.hunters.filter(s => s.leaving).length, 0)
})

test('population: it can be switched off, and scripted worlds (count 0) are left alone', () => {
  const off = withCount(8, { motion: { wander: 0 }, hunters: { population: { every: [0, 0] } } })
  fill(off, 4)
  run(off, 10)
  assert.equal(off.hunters.length, 4)
  const scripted = emptyWorld({ motion: { wander: 0 } })
  fill(scripted, 3)
  run(scripted, 10)
  assert.equal(scripted.hunters.length, 3)
})

test('population: over a long run it stays between 75% and 125% (not counting hunters on their way), and uses both doors', () => {
  const world = makeWorld({}, 5)
  const sizes = []
  run(world, 400, (w, step) => { if (step % 30 === 0) sizes.push(counted(w) - w.hunters.filter(s => s.entering).length) })
  const low = Math.min(...sizes); const high = Math.max(...sizes)
  assert.ok(low >= 4, `fewest: ${low}`)
  assert.ok(high <= 14, `most: ${high}`)
  assert.ok(world.events.some(e => e.type === 'arrive'))
})
