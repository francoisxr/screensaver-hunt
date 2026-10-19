import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeScreen } from '../src/render/compositor.mjs'
import { createCookieStyle } from '../src/render/cookie-style.mjs'
import { DISH_RADIUS_PER_ROW } from '../src/render/dish.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'
import { forgetBodies } from '../src/render/body.mjs'
import { Rng, mulberry32 } from '../src/core/rng.mjs'
import { ASPECT } from './helpers.mjs'

const R0 = 4.5
const look = DEFAULTS.look
const filledDish = rows => {
  const cols = Math.round(rows / ASPECT)
  const R = DISH_RADIUS_PER_ROW * rows
  return { cols, rows, chars: Array.from({ length: cols * rows }, (_, k) => (Math.hypot((k % cols + 0.5 - cols / 2) * ASPECT, Math.floor(k / cols) + 0.5 - rows / 2) <= R ? '@' : ' ')) }
}
function draw ({ rows, drawMass = 1, x = 30.3, y = 25.4, seconds = 100 }) {
  const dish = filledDish(rows)
  const { grid } = composeScreen({
    screen: { cols: 160, rows: 50, col0: 0 },
    hunters: [{ id: 1, bornFrom: 0, x, y, vx: 0, vy: 0, mass: drawMass, ox: 0, oy: 0, drawMass, alpha: 1, fuzz: 0 }],
    links: [], cookies: [], dishFrame: () => dish, cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(look.cookies), aspect: ASPECT, seconds, look, r0: R0, rng: new Rng(mulberry32(1)), background: null,
  })
  const cells = []
  grid.forEach((c, k) => { if (c) cells.push(k) })
  return cells
}
const same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i])
const warm = () => { forgetBodies(); draw({ rows: 20, seconds: 0 }) } // the hunter is first seen at time 0, so it is fully grown at 100

test('steady: where and how big a hunter is drawn does not depend on the size of its dish window', () => {
  warm()
  const reference = draw({ rows: 20 })
  assert.ok(reference.length > 100)
  for (const rows of [6, 11, 12, 13, 17, 19, 21, 22, 23, 28, 31]) {
    assert.ok(same(reference, draw({ rows })), `a ${rows}-row window draws it differently`)
  }
})

test('steady: while a dish window eases to its final size (a row or a column at a time) the hunter does not move or change', () => {
  warm()
  const first = draw({ rows: 12 })
  for (let rows = 13; rows <= 24; rows++) assert.ok(same(first, draw({ rows })), `jump at ${rows} rows`)
})

test('steady: the drawn size follows the hunter\'s size smoothly, with no steps', () => {
  warm()
  let previous = draw({ rows: 20, drawMass: 1 }).length
  let biggestStep = 0
  for (let i = 1; i <= 40; i++) {
    const area = draw({ rows: 20, drawMass: 1 + i * 0.0125 }).length // 1 -> 1.5, in 40 small steps
    biggestStep = Math.max(biggestStep, Math.abs(area - previous) / previous)
    assert.ok(area >= previous - 2, `it shrank at step ${i}`)
    previous = area
  }
  assert.ok(biggestStep < 0.04, `the biggest change between frames is ${(100 * biggestStep).toFixed(1)}%`)
  assert.ok(previous / draw({ rows: 20, drawMass: 1 }).length > 1.3, 'and it did grow by about half')
})

test('steady: the hunter moves smoothly, one cell at a time, whatever its dish window is doing', () => {
  warm()
  const centre = cells => cells.reduce((a, k) => [a[0] + (k % 160), a[1] + Math.floor(k / 160)], [0, 0]).map(v => v / cells.length)
  let last = null
  for (let i = 0; i <= 30; i++) {
    const [cx, cy] = centre(draw({ rows: 14 + (i % 5) * 2, x: 30 + i * 0.07, y: 25 }))
    if (last) assert.ok(Math.hypot(cx - last[0], cy - last[1]) < 1.6, `jumped ${Math.hypot(cx - last[0], cy - last[1]).toFixed(2)} cells at step ${i}`)
    last = [cx, cy]
  }
})
