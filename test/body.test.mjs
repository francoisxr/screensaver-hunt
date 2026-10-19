import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { bodyOf, forgetBodies, SHAPE_NAMES } from '../src/render/body.mjs'
import { composeScreen } from '../src/render/compositor.mjs'
import { createCookieStyle } from '../src/render/cookie-style.mjs'
import { DISH_RADIUS_PER_ROW } from '../src/render/dish.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'
import { Rng, mulberry32 } from '../src/core/rng.mjs'

beforeEach(forgetBodies)

const lookOf = (shapes, sway = 0.14) => ({ shapes, sway, growSeconds: 2.5 })
const measure = body => { // area, centre of mass and furthest point, by sampling (units: radii)
  let n = 0; let mx = 0; let my = 0; let far = 0
  for (let y = -3; y < 3; y += 0.04) for (let x = -3; x < 3; x += 0.04) if (body.field(x, y) <= 0) { n++; mx += x; my += y; far = Math.max(far, Math.hypot(x, y)) }
  return { area: n * 0.04 * 0.04, cx: mx / n, cy: my / n, far }
}

test('body: every shape has the area of a disc, is centred, and reaches as far as it says', () => {
  for (const name of SHAPE_NAMES) {
    forgetBodies() // bodies are cached by hunter id, and this loop reuses one
    const body = bodyOf(7, lookOf([name], 0)); body.pose(0)
    const { area, cx, cy, far } = measure(body)
    assert.ok(Math.abs(area / Math.PI - 1) < 0.12, `${name}: area ${(area / Math.PI).toFixed(2)} discs`)
    assert.ok(Math.hypot(cx, cy) < 0.08, `${name}: centre of mass at ${cx.toFixed(2)}, ${cy.toFixed(2)}`)
    assert.ok(far <= body.reach + 0.02, `${name}: reaches ${far.toFixed(2)} but says ${body.reach.toFixed(2)}`)
    assert.ok(body.reach <= 1.9, `${name}: reaches too far (${body.reach.toFixed(2)})`)
  }
})

test('body: the shapes are not round (all but the blob stray well away from a circle)', () => {
  for (const name of SHAPE_NAMES.filter(n => n !== 'blob')) {
    forgetBodies()
    const body = bodyOf(3, lookOf([name], 0)); body.pose(0)
    let outside = 0; let hollow = 0
    for (let y = -2; y < 2; y += 0.05) for (let x = -2; x < 2; x += 0.05) {
      const inBody = body.field(x, y) <= 0; const inDisc = Math.hypot(x, y) <= 1
      if (inBody && !inDisc) outside++
      if (!inBody && inDisc) hollow++
    }
    assert.ok((outside + hollow) * 0.0025 / Math.PI > 0.35, `${name} differs from a disc by ${((outside + hollow) * 0.0025 / Math.PI).toFixed(2)} discs`)
  }
  forgetBodies()
  const blob = bodyOf(3, lookOf(['blob'], 0)); blob.pose(0)
  assert.ok(Math.abs(measure(blob).far - 1) < 0.05)
})

test('body: each hunter keeps its own shape; different hunters get different ones', () => {
  const a = bodyOf(11, lookOf(SHAPE_NAMES)); a.pose(2)
  assert.equal(bodyOf(11, lookOf(SHAPE_NAMES)), a)
  const kinds = new Set()
  for (let id = 1; id <= 40; id++) { const b = bodyOf(id, lookOf(SHAPE_NAMES)); kinds.add(b.edges.length + ':' + b.base.length) }
  assert.ok(kinds.size >= 6, `${kinds.size} kinds in 40 hunters`)
})

test('body: the same id gives the same body after a restart (deterministic)', () => {
  const first = bodyOf(5, lookOf(SHAPE_NAMES)); first.pose(1)
  const snapshot = JSON.stringify([first.base, first.widths, first.edges])
  forgetBodies()
  const again = bodyOf(5, lookOf(SHAPE_NAMES)); again.pose(1)
  assert.equal(JSON.stringify([again.base, again.widths, again.edges]), snapshot)
})

test('body: the skeleton writhes and slowly spins, but stays one piece and about the same size', () => {
  const body = bodyOf(9, lookOf(['s'])); body.pose(0)
  const before = body.current.map(p => [...p])
  const areas = []
  for (let t = 0; t <= 40; t += 8) { body.pose(t); areas.push(measure(body).area / Math.PI) }
  assert.notDeepEqual(body.current, before)
  assert.ok(Math.max(...areas) - Math.min(...areas) < 0.4, `area swings ${areas.map(a => a.toFixed(2))}`)
  assert.ok(Math.max(...areas) < 1.5 && Math.min(...areas) > 0.7)
})

test('body: a young hunter grows from a disc into its shape, and unknown shape names fall back', () => {
  const body = bodyOf(2, lookOf(['k'])); body.pose(10)
  assert.equal(body.grown(10, 2.5), 0)
  assert.ok(body.grown(11.25, 2.5) > 0.4 && body.grown(11.25, 2.5) < 0.6)
  assert.equal(body.grown(20, 2.5), 1)
  assert.equal(body.grown(10, 0), 1)
  forgetBodies()
  assert.ok(bodyOf(2, lookOf(['no-such-shape'])).reach > 0)
})

// ---- drawn on a screen -----------------------------------------------------------------------------------

const aspect = 0.46
function draw (shapes, hunterOver = {}, seconds = [0, 10]) {
  const look = { ...DEFAULTS.look, body: lookOf(shapes) }
  const rows = 24; const cols = Math.round(rows / aspect)
  const R = DISH_RADIUS_PER_ROW * rows
  const chars = Array.from({ length: cols * rows }, (_, k) => (Math.hypot((k % cols + 0.5 - cols / 2) * aspect, Math.floor(k / cols) + 0.5 - rows / 2) <= R ? '@' : ' '))
  const hunter = { id: 4, x: 30, y: 25, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0, ...hunterOver }
  let grid
  for (const t of seconds) {
    grid = composeScreen({
      screen: { cols: 160, rows: 50, col0: 0 }, hunters: [hunter], links: [], cookies: [],
      dishFrame: () => ({ cols, rows, chars }), cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
      cookieShade: createCookieStyle(look.cookies), aspect, seconds: t, look, rng: new Rng(mulberry32(1)), background: null,
    }).grid
  }
  const cells = []
  grid.forEach((c, k) => { if (c) cells.push([k % 160, Math.floor(k / 160)]) })
  return { cells, radius: R / look.pad }
}

test('compositor: a new hunter is a disc; grown, it takes its body shape with about the same area', () => {
  const young = draw(['k'], {}, [0])
  forgetBodies()
  const grown = draw(['k'], {}, [0, 10])
  const discArea = Math.PI * young.radius ** 2 / aspect // in cells
  assert.ok(Math.abs(young.cells.length / discArea - 1) < 0.15, `young ${(young.cells.length / discArea).toFixed(2)} discs`)
  assert.ok(Math.abs(grown.cells.length / discArea - 1) < 0.3, `grown ${(grown.cells.length / discArea).toFixed(2)} discs`)
  const cx = 30 / aspect; const cy = 25
  const outside = grown.cells.filter(([x, y]) => Math.hypot((x + 0.5 - cx) * aspect, y + 0.5 - cy) > grown.radius * 1.15).length
  assert.ok(outside > discArea * 0.1, 'a good part of the body is outside the disc it would have been')
  const stray = young.cells.filter(([x, y]) => Math.hypot((x + 0.5 - cx) * aspect, y + 0.5 - cy) > young.radius * 1.15).length
  assert.ok(stray < 5, 'the young hunter is round')
})

test('compositor: the dish picture is shown inside the body, not just a silhouette', () => {
  const { cells } = draw(['u'], {}, [0, 10])
  assert.ok(cells.length > 300)
})

// ---- a split piece starts as its parent --------------------------------------------------------------------

function silhouette (hunters, seconds) {
  const look = { ...DEFAULTS.look, body: lookOf(['k', 'u', 's', 'y', 'z']) }
  const rows = 24; const cols = Math.round(rows / aspect)
  const R = DISH_RADIUS_PER_ROW * rows
  const chars = Array.from({ length: cols * rows }, (_, k) => (Math.hypot((k % cols + 0.5 - cols / 2) * aspect, Math.floor(k / cols) + 0.5 - rows / 2) <= R ? '@' : ' '))
  const { grid } = composeScreen({
    screen: { cols: 160, rows: 50, col0: 0 }, hunters, links: [], cookies: [],
    dishFrame: () => ({ cols, rows, chars }), cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(look.cookies), aspect, seconds, look, rng: new Rng(mulberry32(1)), background: null,
  })
  const cells = new Set()
  grid.forEach((c, k) => { if (c) cells.add(k) })
  return cells
}
const hunterAt = (id, bornFrom = 0) => ({ id, bornFrom, x: 30, y: 25, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0 })
const difference = (a, b) => { let n = 0; for (const k of a) if (!b.has(k)) n++; for (const k of b) if (!a.has(k)) n++; return n }

test('body: a split piece starts out exactly as its parent looks, with no pop', () => {
  silhouette([hunterAt(1)], 0) // the parent is seen first...
  const parent = silhouette([hunterAt(1)], 20) // ...and is fully grown
  const piece = silhouette([hunterAt(2, 1)], 20) // a piece of it appears at the same place, at the same moment
  assert.equal(difference(parent, piece), 0, 'the new piece is drawn exactly like the parent')
  assert.ok(parent.size > 100)
})

test('body: ...then morphs smoothly into a shape of its own, with no frame-to-frame jump', () => {
  silhouette([hunterAt(1)], 0)
  silhouette([hunterAt(1)], 20)
  let previous = silhouette([hunterAt(2, 1)], 20)
  let biggest = 0
  const first = previous
  for (let f = 1; f <= 30 * 5; f++) {
    const now = silhouette([hunterAt(2, 1)], 20 + f / 30)
    biggest = Math.max(biggest, difference(previous, now))
    previous = now
  }
  assert.ok(biggest < 0.12 * first.size, `the biggest change in one frame is ${biggest} cells of ${first.size}`)
  assert.ok(difference(first, previous) > 20, 'and it did end up different from its parent')
})

test('body: a piece of a hunter that was never drawn starts as a disc', () => {
  const piece = bodyOf(30, lookOf(['k']), 29)
  assert.equal(piece.parent, null)
})
