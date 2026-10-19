import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHunter } from '../src/physics/hunter.mjs'
import { kickNextHunter } from '../src/physics/kicks.mjs'
import { screenCorners } from '../src/physics/layout.mjs'
import { makeWorld, emptyWorld, run, ASPECT, ROWS, SCREENS, AREA_W } from './helpers.mjs'

const snapshot = w => JSON.stringify(w.hunters.map(s => [s.id, s.x, s.y, s.vx, s.vy, s.mass, s.sickUntil]))
const near = (a, b, tolerance = 0.011) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`)

test('screenCorners: three screens side by side have 8 distinct corners, including where screens meet', () => {
  const corners = screenCorners(SCREENS, ASPECT, ROWS)
  assert.equal(corners.length, 8)
  assert.ok(corners.some(c => Math.abs(c[0] - 174 * ASPECT) < 1e-9 && c[1] === 0)) // the seam, top
  assert.ok(corners.some(c => Math.abs(c[0] - 522 * ASPECT) < 1e-9 && c[1] === ROWS))
})

test('the world starts with the configured number of hunters, apart from each other', () => {
  const world = makeWorld({ hunters: { count: 9 } })
  assert.equal(world.hunters.length, 9)
  for (const a of world.hunters) {
    for (const b of world.hunters) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > world.radius(a) + world.radius(b))
  }
})

test('the same seed reproduces a run exactly; another seed does not', () => {
  const a = makeWorld({}, 5)
  const b = makeWorld({}, 5)
  const c = makeWorld({}, 6)
  run(a, 60)
  run(b, 60)
  run(c, 60)
  assert.equal(snapshot(a), snapshot(b))
  assert.notEqual(snapshot(a), snapshot(c))
  assert.deepEqual(a.events, b.events)
})

test('hunters never leave the area', () => {
  const world = makeWorld({}, 2)
  run(world, 120, w => {
    for (const s of w.hunters.filter(x => !x.ghost && !x.entering && !x.leaving)) { // (those walking in or out are outside on purpose)
      // (A hunter that has just grown by eating can be a fraction inside its new limit until the next step.)
      const hard = w.cfg.walls.hard * w.radius(s) - 0.5
      assert.ok(s.x >= hard && s.x <= w.w - hard, `x ${s.x} out of range`)
      assert.ok(s.y >= hard && s.y <= w.h - hard, `y ${s.y} out of range`)
    }
  })
})

test('there are never more cookies than the maximum, and never more hunters than the cap', () => {
  const world = makeWorld({ cookies: { max: 3 }, hunters: { max: 12 } }, 3)
  run(world, 90, w => {
    assert.ok(w.cookies.length <= 3)
    assert.ok(w.hunters.length <= 12)
  })
})

test('a merge keeps 75% of the combined mass, exactly', () => {
  const world = makeWorld({ merging: { chance: 1 } }, 4)
  const merges = []
  let before = new Map()
  run(world, 150, w => {
    for (const e of w.events.slice(merges.length ? -1 : 0)) void e
  })
  // Re-run, watching the masses just before each step.
  const watched = makeWorld({ merging: { chance: 1 } }, 4)
  const dt = 1 / 30
  for (let i = 0; i < 150 * 30; i++) {
    before = new Map(watched.hunters.map(s => [s.id, s.mass]))
    const seen = watched.events.length
    watched.step(dt)
    for (const e of watched.events.slice(seen)) {
      if (e.type === 'merge') merges.push(e)
      if (e.type === 'merge') near(e.mass, 0.75 * (before.get(e.keep) + before.get(e.gone)))
    }
  }
  assert.ok(merges.length >= 3, 'expected several merges with chance 1')
})

test('merging happens one step at a time: the pair eases together, then the absorbed hunter is gone', () => {
  const world = emptyWorld({ merging: { chance: 1, seconds: 1 }, motion: { wander: 0 }, repulsion: { strength: 0 }, hunting: { accel: 0 } })
  const a = createHunter(world, 100, 22, 1)
  const b = createHunter(world, 100 + 2 * world.r0 + 0.5, 22, 1)
  a.vx = 2
  b.vx = -2
  world.hunters.push(a, b)
  run(world, 0.6)
  assert.ok(world.events.some(e => e.type === 'merge'), 'they merged')
  assert.ok(!world.events.some(e => e.type === 'merged'), 'but the merge is still going on')
  const ghost = world.hunters.find(s => s.ghost)
  assert.ok(ghost, 'the absorbed hunter is still there, as a follower')
  assert.ok(ghost.alpha < 1 || ghost.drawMass < 1, 'and it is already fading')
  assert.equal(world.links.length, 1, 'with a neck joining the two')
  run(world, 2.5)
  assert.equal(world.hunters.filter(s => !s.ghost).length, 1)
  assert.equal(world.hunters.length, 1)
  assert.ok(world.events.some(e => e.type === 'merged'))
  near(world.hunters[0].mass, 1.5)
  assert.equal(world.hunters[0].anim, null)
})

test('a sick hunter splits after its time, into 2 or 3 pieces holding 75% of its mass, with nothing left over', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = emptyWorld({}, seed)
    const s = createHunter(world, 120, 22, 3.4)
    world.hunters.push(s)
    s.sickUntil = 2
    run(world, 1.9)
    assert.equal(world.hunters.length, 1)
    run(world, 0.3) // the time is up: the split starts
    const split = world.events.find(e => e.type === 'split')
    assert.ok(split, 'the split started')
    const pieces = split.pieces.length
    assert.ok(pieces === 2 || pieces === 3)
    near(split.masses.reduce((x, y) => x + y, 0), 0.75 * 3.4, 0.02)
    run(world, world.cfg.splitting.seconds + 0.5)
    assert.equal(world.hunters.length, pieces)
    assert.ok(world.hunters.every(x => !x.ghost && !x.anim))
    near(world.hunters.reduce((x, y) => x + y.mass, 0), 0.75 * 3.4, 0.02)
    for (const p of world.hunters.filter(x => x.id !== s.id)) assert.equal(p.bornFrom, s.id)
  }
})

test('a split with no room left only recovers, still losing the mass', () => {
  const world = emptyWorld({ hunters: { max: 1 } })
  const s = createHunter(world, 120, 22, 3.4)
  world.hunters.push(s)
  s.sickUntil = 0.1
  run(world, 0.5)
  assert.equal(world.hunters.length, 1)
  near(s.mass, 0.75 * 3.4, 0.02)
  assert.ok(world.events.some(e => e.type === 'recover'))
})

test('a hunter over the sick mass that eats becomes sick; one under it does not', () => {
  const world = emptyWorld({ cookies: { max: 0 } })
  const big = createHunter(world, 60, 22, 2.99)
  const small = createHunter(world, 180, 22, 1)
  world.hunters.push(big, small)
  world.cookies.push({ id: 900, x: 60, y: 22, born: 0 }, { id: 901, x: 180, y: 22, born: 0 })
  run(world, 0.2)
  assert.equal(world.cookies.length, 0)
  assert.ok(big.sickUntil > 0)
  assert.equal(small.sickUntil, 0)
  near(small.mass, 1 + world.cfg.cookies.mass)
})

test('a hunter eats a cookie it touches, gains the configured mass and becomes full', () => {
  const world = emptyWorld()
  const s = createHunter(world, 100, 22, 1)
  world.hunters.push(s)
  world.cookies.push({ id: 900, x: 101, y: 22, born: 0 })
  run(world, 0.1)
  assert.equal(world.cookies.length, 0)
  near(s.mass, 1 + world.cfg.cookies.mass)
  assert.ok(s.fullUntil > world.t)
})

test('uneaten cookies spoil', () => {
  const world = emptyWorld({ cookies: { max: 0, life: 2 } })
  world.hunters.push(createHunter(world, 200, 40, 1)) // (a world with no hunters does not step)
  world.cookies.push({ id: 900, x: 10, y: 10, born: 0 })
  run(world, 3)
  assert.equal(world.cookies.length, 0)
})

test('hunting: a hunter heads for a cookie that appears, much faster than it drifts', () => {
  const world = emptyWorld({ motion: { wander: 0 } })
  const s = createHunter(world, 60, 22, 1)
  world.hunters.push(s)
  world.cookies.push({ id: 900, x: 200, y: 22, born: 0 })
  run(world, 3, () => {})
  assert.ok(s.x > 100, `the hunter moved toward the cookie (x = ${s.x})`)
  assert.ok(Math.abs(s.y - 22) < 6)
})

test('hunting can be switched off', () => {
  const world = emptyWorld({ motion: { wander: 0 }, hunting: { accel: 0 } })
  const s = createHunter(world, 60, 22, 1)
  world.hunters.push(s)
  world.cookies.push({ id: 900, x: 200, y: 22, born: 0 })
  run(world, 3)
  assert.ok(Math.abs(s.x - 60) < 1)
})

test('a hunter that just ate chases half-heartedly; a sick one does not hunt at all', () => {
  const world = emptyWorld({ motion: { wander: 0 } })
  const full = createHunter(world, 60, 22, 1)
  const sick = createHunter(world, 60, 40, 1)
  full.fullUntil = 100
  sick.sickUntil = 100
  world.hunters.push(full, sick)
  world.cookies.push({ id: 900, x: 200, y: 22, born: 0 })
  run(world, 2)
  assert.ok(full.x > 60 + 5, 'the full hunter still moves')
  assert.equal(sick.prey, null)
})

test('kicks take turns: everybody is kicked once before anybody is kicked twice', () => {
  const world = emptyWorld()
  for (let i = 0; i < 4; i++) world.hunters.push(createHunter(world, 30 + i * 50, 22, 1))
  const first = Array.from({ length: 4 }, () => kickNextHunter(world).id)
  const second = Array.from({ length: 4 }, () => kickNextHunter(world).id)
  const all = world.hunters.map(s => s.id).sort()
  assert.deepEqual([...first].sort(), all)
  assert.deepEqual([...second].sort(), all)
})

test('events are reported to a listener', () => {
  const world = makeWorld({ merging: { chance: 1 } }, 4)
  const types = new Set()
  world.onEvent = e => types.add(e.type)
  run(world, 120)
  assert.ok(types.has('eat'))
  assert.ok(types.has('merge') && types.has('merged'))
})

test('the area is the wide strip of all screens', () => {
  const world = makeWorld()
  assert.equal(world.w, AREA_W)
  assert.equal(world.h, ROWS)
})

test('a split near a wall releases every piece inside the area, without a jump at the release', () => {
  for (const [x, y] of [[8, 22], [120, 4], [230, 40], [8, 4]]) {
    for (const seed of [1, 2, 3, 4]) {
      const world = emptyWorld({}, seed)
      const s = createHunter(world, x, y, 3.4)
      world.hunters.push(s)
      s.sickUntil = 0.05
      let lastVisual = null
      let released = false
      run(world, 4, w => {
        const pieces = w.hunters
        if (!released && w.events.some(e => e.type === 'split-done')) {
          released = true
          for (const p of pieces) {
            const hard = w.cfg.walls.hard * w.radius(p)
            assert.ok(p.x >= hard - 1e-6 && p.x <= w.w - hard + 1e-6 && p.y >= hard - 1e-6 && p.y <= w.h - hard + 1e-6, `piece outside at the release (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`)
            const before = lastVisual.get(p.id)
            // the position it had on screen just before the release is where it is after it
            assert.ok(Math.hypot(p.x - before[0], p.y - before[1]) < 1.5, `jump of ${Math.hypot(p.x - before[0], p.y - before[1]).toFixed(2)} units at the release`)
          }
        }
        lastVisual = new Map(pieces.map(p => [p.id, [p.x + p.ox, p.y + p.oy]]))
      })
      assert.ok(released, 'the split finished')
    }
  }
})
