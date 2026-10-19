import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHunter } from '../src/physics/hunter.mjs'
import { composeScreen } from '../src/render/compositor.mjs'
import { createCookieStyle } from '../src/render/cookie-style.mjs'
import { DISH_RADIUS_PER_ROW } from '../src/render/dish.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'
import { Rng, mulberry32 } from '../src/core/rng.mjs'
import { makeWorld, emptyWorld, run, ASPECT, ROWS } from './helpers.mjs'

const wrapped = (patch = {}, seed = 1) => emptyWorld({ wrap: true, motion: { wander: 0 }, hunting: { stalk: { minHunters: 0 } }, ...patch }, seed)
const place = (world, x, y, mass = 1) => { const s = createHunter(world, x, y, mass); world.hunters.push(s); return s }

// ---- the world wraps ---------------------------------------------------------------------------------------

test('wrap: a hunter that leaves through the right edge comes back in through the left one, and the same for the bottom and the top', () => {
  const world = wrapped()
  const a = place(world, world.w - 1, 22); a.vx = 30
  const b = place(world, 100, world.h - 1); b.vy = 20
  const c = place(world, 150, 1); c.vy = -20
  run(world, 0.3)
  assert.ok(a.x >= 0 && a.x < 10, `right to left: x = ${a.x}`)
  assert.ok(b.y >= 0 && b.y < 10, `bottom to top: y = ${b.y}`)
  assert.ok(c.y > world.h - 10 && c.y < world.h, `top to bottom: y = ${c.y}`)
  assert.ok(Math.abs(a.vx - 30) < 5, 'and it keeps its speed')
})

test('wrap: everybody stays within the area, and over a long run they do cross the edges', () => {
  const world = makeWorld({ wrap: true }, 4)
  let crossings = 0
  const last = new Map()
  run(world, 200, w => {
    for (const s of w.hunters) {
      assert.ok(s.x >= 0 && s.x < w.w && s.y >= 0 && s.y < w.h, `${s.x}, ${s.y}`)
      const before = last.get(s.id)
      if (before && (Math.abs(s.x - before[0]) > w.w / 2 || Math.abs(s.y - before[1]) > w.h / 2)) crossings++
      last.set(s.id, [s.x, s.y])
    }
  })
  assert.ok(crossings > 0, 'somebody went round')
})

test('wrap: there are no walls, so no spring and no bounce at the edge, and no corners to avoid', () => {
  const world = wrapped()
  assert.deepEqual(world.corners, [])
  const s = place(world, world.w - 2, 22); s.vx = 10
  run(world, 1)
  assert.ok(s.vx > 5, 'it was not pushed back')
})

test('wrap: hunters on either side of an edge see each other: they repel and bounce', () => {
  const world = wrapped()
  const a = place(world, 2, 22)
  const b = place(world, world.w - 2, 22) // 4 apart across the edge
  const d0 = world.distance(a, b)
  assert.ok(d0 < 5)
  run(world, 0.5)
  assert.ok(world.distance(a, b) > d0, 'they pushed each other apart across the edge')
})

test('wrap: a cookie on the other side of the edge is eaten', () => {
  const world = wrapped()
  const s = place(world, 1, 22)
  world.cookies.push({ id: 900, x: world.w - 1, y: 22, born: 0 })
  run(world, 0.1)
  assert.equal(world.cookies.length, 0)
  assert.ok(s.mass > 1)
})

test('wrap: a hunter heads for a cookie the short way, through the edge', () => {
  const world = wrapped()
  const s = place(world, 8, 22)
  world.cookies.push({ id: 900, x: world.w - 8, y: 22, born: 0 }) // 16 away through the edge, 208 the other way
  run(world, 1)
  assert.ok(s.vx < -5, `it set off to the left: vx = ${s.vx}`)
})

test('wrap: a hunter hunts its prey the short way, through the edge', () => {
  const world = wrapped()
  const big = place(world, 8, 22, 2)
  const small = place(world, world.w - 12, 22, 1)
  world.step(1 / 30)
  assert.ok(big.stalk, 'it is hunting')
  run(world, 0.3) // (before it reaches its prey: that is a few frames, with the pounce)
  assert.ok(big.vx < -5, `it ran to the left: vx = ${big.vx}`)
  assert.ok(world.dx(small.x - big.x) < 0 && Math.abs(world.dx(small.x - big.x)) < 20, 'toward the prey, the short way')
})

test('wrap: two hunters on either side of an edge merge at the edge, not in the middle of the world', () => {
  const world = wrapped({ merging: { chance: 1 }, hunting: { stalk: { drive: 0 } } })
  place(world, world.w - 3, 22, 1)
  place(world, 3, 22, 1)
  run(world, 0.1)
  const merge = world.events.find(e => e.type === 'merge')
  assert.ok(merge, 'they merged')
  const keep = world.hunters.find(s => s.id === merge.keep)
  const fromEdge = Math.min(keep.x, world.w - keep.x)
  assert.ok(fromEdge < 4, `the merged hunter is at x = ${keep.x}`)
})

test('wrap: the world can still have walls', () => {
  const world = emptyWorld({ wrap: false, motion: { wander: 0 } })
  const s = place(world, world.w - 2, 22); s.vx = 30
  run(world, 1)
  assert.ok(s.x < world.w && s.x > world.w * 0.8, `it stayed at the right edge (x = ${s.x}), it did not wrap to the left`)
})

// ---- drawn across the edge ---------------------------------------------------------------------------------

const COLS = 160
const ROW_COUNT = 50
function draw (hunter, wrap = true) {
  const look = DEFAULTS.look
  const rows = 24
  const cols = Math.round(rows / ASPECT)
  const R = DISH_RADIUS_PER_ROW * rows
  const chars = Array.from({ length: cols * rows }, (_, k) => (Math.hypot((k % cols + 0.5 - cols / 2) * ASPECT, Math.floor(k / cols) + 0.5 - rows / 2) <= R ? '@' : ' '))
  const { grid } = composeScreen({
    screen: { cols: COLS, rows: ROW_COUNT, col0: 0 }, hunters: [{ id: 1, bornFrom: 0, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0, ...hunter }], links: [], cookies: [],
    dishFrame: () => ({ cols, rows, chars }), cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(look.cookies), aspect: ASPECT, seconds: 0, look, rng: new Rng(mulberry32(1)), background: null,
    wrap: wrap ? { cols: COLS, rows: ROW_COUNT } : null,
  })
  const left = []; const right = []; const top = []; const bottom = []
  grid.forEach((c, k) => { if (!c) return; const x = k % COLS; const y = Math.floor(k / COLS); if (x < COLS / 4) left.push(k); if (x >= COLS * 3 / 4) right.push(k); if (y < ROW_COUNT / 4) top.push(k); if (y >= ROW_COUNT * 3 / 4) bottom.push(k) })
  return { left: left.length, right: right.length, top: top.length, bottom: bottom.length, total: grid.filter(Boolean).length }
}

test('drawing: a hunter sitting across the right edge is drawn on both sides of it, as one body', () => {
  const split = draw({ x: COLS * ASPECT - 1, y: 25 })
  assert.ok(split.left > 50 && split.right > 50, `left ${split.left}, right ${split.right}`)
  const whole = draw({ x: COLS * ASPECT / 2, y: 25 })
  assert.ok(Math.abs(split.total / whole.total - 1) < 0.15, `${split.total} cells split, ${whole.total} whole`)
})

test('drawing: a hunter sitting across the bottom edge is drawn at the top too', () => {
  const split = draw({ x: 30, y: ROW_COUNT - 1 })
  assert.ok(split.top > 30 && split.bottom > 30, `top ${split.top}, bottom ${split.bottom}`)
})

test('drawing: without wrapping, the part that sticks out is simply cut off', () => {
  const cut = draw({ x: COLS * ASPECT - 1, y: 25 }, false)
  assert.equal(cut.left, 0)
  assert.ok(cut.right > 50)
})

test('drawing: a hunter in the middle is drawn once (no ghosts at the other edge)', () => {
  const middle = draw({ x: COLS * ASPECT / 2, y: 25 })
  assert.equal(middle.left + middle.right, 0)
})

// ---- spawning sizes ----------------------------------------------------------------------------------------

test('spawn: starting sizes are varied, and in every world at least one hunter is big enough to hunt its closest neighbour', () => {
  let spread = 0
  for (let seed = 1; seed <= 30; seed++) {
    const world = makeWorld({ wrap: seed % 2 === 0 }, seed)
    const masses = world.hunters.map(s => s.mass)
    spread += Math.max(...masses) / Math.min(...masses)
    const { ratio } = world.cfg.hunting.stalk
    const ready = world.hunters.some(a => {
      const near = world.hunters.filter(b => b !== a).reduce((p, b) => (world.distance(a, b) < world.distance(a, p) ? b : p))
      return a.mass >= near.mass * ratio
    })
    assert.ok(ready, `seed ${seed}: nobody is ready to hunt`)
    assert.ok(Math.max(...masses) < world.cfg.sickness.mass, 'and nobody starts sick')
  }
  assert.ok(spread / 30 > 2, `the biggest starter is ${(spread / 30).toFixed(1)} times the smallest on average`)
})

// ---- the population, in a world that wraps -----------------------------------------------------------------

test('population (wrapping): a newcomer fades in where it is, and is a normal hunter afterwards', () => {
  const world = emptyWorld({ wrap: true, motion: { wander: 0 }, hunters: { count: 8, sizeJitter: 0.1 } })
  world.hunters.length = 0
  for (let i = 0; i < 5; i++) place(world, 30 + i * 40, 22)
  let newcomer = null
  const alphas = []
  run(world, 4, () => {
    newcomer ??= world.hunters.find(s => s.entering)
    if (newcomer) alphas.push(newcomer.alpha)
  })
  assert.ok(newcomer, 'somebody arrived')
  assert.ok(alphas[0] < 0.2 && alphas.at(-1) === 1, `alpha ${alphas[0]} -> ${alphas.at(-1)}`)
  assert.ok(alphas.every((a, i) => i === 0 || a >= alphas[i - 1] - 1e-9), 'steadily')
  assert.equal(newcomer.entering, null)
  assert.ok(newcomer.x >= 0 && newcomer.x <= world.w, 'and it never came from outside')
})

test('population (wrapping): too many, and the smallest fades away and is gone', () => {
  const world = emptyWorld({ wrap: true, motion: { wander: 0 }, hunters: { count: 8, sizeJitter: 0.1 } })
  world.hunters.length = 0
  for (let i = 0; i < 11; i++) place(world, 20 + i * 20, 10 + (i % 3) * 12, i === 4 ? 0.4 : 1)
  const smallest = world.hunters[4]
  run(world, 1)
  assert.ok(smallest.leaving && smallest.alpha < 1, 'the smallest is fading')
  run(world, 3)
  assert.ok(!world.hunters.includes(smallest), 'and gone')
})
