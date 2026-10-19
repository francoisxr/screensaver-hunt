import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wobbleTable, binOf, unstretch, BINS } from '../src/render/wobble.mjs'
import { cookieCells, WIDTH, HEIGHT } from '../src/render/cookie-shape.mjs'
import { createCookieStyle } from '../src/render/cookie-style.mjs'
import { CookieAnimator } from '../src/render/cookie-animator.mjs'
import { composeScreen, cellHash } from '../src/render/compositor.mjs'
import { gridToAnsi } from '../src/core/frame.mjs'
import { Rng, mulberry32 } from '../src/core/rng.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'

const look = DEFAULTS.look
const ASPECT = 0.46

test('wobble: bounded by the amplitude, deterministic, different for each hunter, and moving', () => {
  const a = wobbleTable(3, 1.5, 0.1)
  assert.equal(a.length, BINS)
  assert.ok(Math.max(...a.map(Math.abs)) <= 0.1 + 1e-9)
  assert.deepEqual([...wobbleTable(3, 1.5, 0.1)], [...a])
  assert.notDeepEqual([...wobbleTable(4, 1.5, 0.1)], [...a])
  assert.notDeepEqual([...wobbleTable(3, 2.5, 0.1)], [...a])
  const reused = new Float32Array(BINS)
  assert.equal(wobbleTable(3, 1.5, 0.1, reused), reused)
})

test('wobble: binOf covers every direction', () => {
  assert.equal(binOf(1, 0), BINS / 2) // straight to the right is the middle of the table
  assert.equal(binOf(-1, 0), BINS - 1) // straight to the left is the last bin (the angle wraps)
  const seen = new Set()
  for (let a = -Math.PI; a < Math.PI; a += 0.01) seen.add(binOf(Math.cos(a), Math.sin(a)))
  assert.equal(seen.size, BINS)
  assert.ok([...seen].every(k => k >= 0 && k < BINS))
})

test('unstretch: no stretch changes nothing; a stretch lengthens along the direction and keeps the area', () => {
  const [x, y] = unstretch(3, 4, 1, 0, 1)
  assert.ok(Math.abs(x - 3) < 1e-12 && Math.abs(y - 4) < 1e-12)
  // A point on the stretched hunter's long axis maps to a point S times nearer the centre.
  const [ax, ay] = unstretch(2, 0, 1, 0, 2)
  assert.ok(Math.abs(ax - 1) < 1e-12 && Math.abs(ay) < 1e-12)
  // Across the motion it narrows by sqrt(S): the area (S * 1/sqrt(S)^2) is kept.
  const [bx, by] = unstretch(0, 1, 1, 0, 2)
  assert.ok(Math.abs(bx) < 1e-12 && Math.abs(by - Math.SQRT2) < 1e-12)
})

test('cookie shape: a 5x3 ring of dense characters with heavy bars in every second column', () => {
  const cells = cookieCells(1, { pulse: 0, shimmer: 0, fear: 0 }, ASPECT, look.cookies.shape)
  assert.ok(cells.length > 6 && cells.length <= WIDTH * HEIGHT)
  for (const c of cells) {
    assert.ok(c.dx >= 0 && c.dx < WIDTH && c.dy >= 0 && c.dy < HEIGHT)
    assert.ok(c.light >= look.cookies.shape.minLight - 1e-9 && c.light <= 1 + 1e-9)
    if (c.dx % 2) assert.equal(c.char, '┃')
    else assert.ok(c.char.length === 1 && c.char !== '┃')
  }
  assert.ok(!cells.some(c => c.dx === 2 && c.dy === 1), 'the middle of the ring is open')
})

test('cookie shape: the breathing changes it, deterministically', () => {
  const at = pulse => JSON.stringify(cookieCells(1, { pulse, shimmer: 0, fear: 0 }, ASPECT, look.cookies.shape))
  assert.notEqual(at(0), at(Math.PI))
  assert.equal(at(1), at(1))
})

test('cookie style: the white theme runs from grey (faint) to white (the ring)', () => {
  const shade = createCookieStyle(look.cookies)(7, 3)
  assert.deepEqual(shade(1), [255, 255, 255])
  const faint = shade(look.cookies.shape.minLight)
  assert.ok(faint[0] === faint[1] && faint[1] === faint[2] && faint[0] < 140 && faint[0] > 90)
})

test('cookie style: a coloured theme passes through its vivid colour', () => {
  const style = createCookieStyle({ ...look.cookies, theme: 'phosphor' })
  const mid = style(1, 0)(0.4 + 0.6 * 0.6) // 60% of the way up the glow: the pure colour
  assert.ok(mid[1] > 200 && mid[0] < 120, `got ${mid}`)
})

test('cookie style: an unknown theme falls back to white', () => {
  assert.deepEqual(createCookieStyle({ ...look.cookies, theme: 'nope' })(1, 0)(1), [255, 255, 255])
})

test('cookie animator: fear is high near a hunter, low (but never NaN) far from every hunter', () => {
  const animator = new CookieAnimator(look.cookies, new Rng(mulberry32(1)))
  const cookies = [{ id: 1, x: 100, y: 20 }, { id: 2, x: 220, y: 20 }]
  const hunters = [{ x: 100, y: 28, mass: 1 }] // 8 units from cookie 1; 120 from cookie 2
  for (let i = 0; i < 60; i++) animator.update(cookies, hunters, () => 5, 1 / 30, i * 33, look.cookies.shape)
  const near = animator.view(1)
  const far = animator.view(2)
  assert.ok(near.fear > 0.6)
  assert.ok(Number.isFinite(far.fear) && Math.abs(far.fear - look.cookies.fear.nervous) < 0.02, `far cookie fear ${far.fear}`)
  assert.ok(Number.isFinite(far.pulse) && Number.isFinite(far.shimmer))
  assert.ok(far.pulse > 0, 'a far cookie still breathes')
})

test('cookie animator: with no hunters at all every cookie is merely nervous', () => {
  const animator = new CookieAnimator(look.cookies, new Rng(mulberry32(1)))
  animator.update([{ id: 1, x: 1, y: 1 }], [], () => 1, 0.1, 0, look.cookies.shape)
  assert.ok(Number.isFinite(animator.view(1).fear))
})

test('cookie animator: a frightened cookie shivers (jumps around its spot); a calm one mostly does not', () => {
  const run = fearful => {
    const animator = new CookieAnimator(look.cookies, new Rng(mulberry32(2)))
    const cookies = [{ id: 1, x: 100, y: 20 }]
    const hunters = fearful ? [{ x: 100, y: 24, mass: 1 }] : []
    let moves = 0
    for (let i = 0; i < 300; i++) {
      animator.update(cookies, hunters, () => 2, 1 / 30, i * 33, look.cookies.shape)
      if (animator.view(1).jx || animator.view(1).jy) moves++
    }
    return moves
  }
  assert.ok(run(true) > run(false) * 2)
})

test('cookie animator: forgets cookies that are gone', () => {
  const animator = new CookieAnimator(look.cookies, new Rng(mulberry32(3)))
  animator.update([{ id: 1, x: 1, y: 1 }, { id: 2, x: 5, y: 5 }], [], () => 1, 0.1, 0, look.cookies.shape)
  assert.equal(animator.views.size, 2)
  animator.update([{ id: 2, x: 5, y: 5 }], [], () => 1, 0.1, 100, look.cookies.shape)
  assert.equal(animator.views.size, 1)
})

// ---- the compositor ----------------------------------------------------------------------------------

function hunter (over = {}) {
  return { id: 1, x: 20, y: 10, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0, ...over }
}

/** A solid dish picture: 'X' everywhere inside its window. */
function solidFrame (rows = 20) {
  const cols = Math.round(rows / ASPECT)
  return { cols, rows, chars: new Array(cols * rows).fill('X') }
}

function compose (over = {}) {
  const frame = solidFrame()
  const hunters = over.hunters ?? [hunter()]
  return composeScreen({
    screen: { cols: 100, rows: 30, col0: 0 },
    hunters,
    links: [],
    cookies: [],
    dishFrame: id => (hunters.some(s => s.id === id) ? frame : undefined),
    cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(look.cookies),
    aspect: ASPECT,
    seconds: 1,
    look,
    rng: new Rng(mulberry32(1)),
    ...over,
  })
}

const drawn = grid => grid.filter(Boolean).length
const columnsOf = (grid, cols) => grid.map((c, i) => (c ? i % cols : -1)).filter(x => x >= 0)
const rowsOf = (grid, cols) => grid.map((c, i) => (c ? Math.floor(i / cols) : -1)).filter(x => x >= 0)

test('compositor: a hunter is drawn around its position', () => {
  const { grid } = compose({ hunters: [hunter({ x: 20, y: 10 })] })
  assert.ok(drawn(grid) > 100)
  const cols = columnsOf(grid, 100)
  const rows = rowsOf(grid, 100)
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2
  const midRow = (Math.min(...rows) + Math.max(...rows)) / 2
  assert.ok(Math.abs(midCol - 20 / ASPECT) < 3, `centred on column ${midCol}`)
  assert.ok(Math.abs(midRow - 10) < 2, `centred on row ${midRow}`)
})

test('compositor: the same world drawn on two screens equals one wide screen', () => {
  const hunters = [hunter({ x: 24.5, y: 10 })] // straddles the seam at column 50 (x = 23 units)
  const whole = compose({ hunters, screen: { cols: 100, rows: 30, col0: 0 } }).grid
  const left = compose({ hunters, screen: { cols: 50, rows: 30, col0: 0 } }).grid
  const right = compose({ hunters, screen: { cols: 50, rows: 30, col0: 50 } }).grid
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 100; x++) {
      const expected = whole[x + y * 100]
      const part = x < 50 ? left[x + y * 50] : right[x - 50 + y * 50]
      assert.equal(Boolean(part), Boolean(expected), `cell ${x},${y}`)
      if (part) assert.equal(part.char, expected.char)
    }
  }
  assert.ok(drawn(left) > 0 && drawn(right) > 0, 'both halves have something')
})

test('compositor: a hunter partly off the screen is clipped, not wrapped', () => {
  const { grid } = compose({ hunters: [hunter({ x: 0, y: 0 })] })
  assert.ok(drawn(grid) > 20)
  assert.ok(columnsOf(grid, 100).every(c => c < 40))
  assert.ok(rowsOf(grid, 100).every(r => r < 20))
})

test('compositor: an almost invisible hunter is not drawn; a half faded one is drawn about half', () => {
  assert.equal(drawn(compose({ hunters: [hunter({ alpha: 0.005 })] }).grid), 0)
  const full = drawn(compose({ hunters: [hunter()] }).grid)
  const half = drawn(compose({ hunters: [hunter({ alpha: 0.5 })] }).grid)
  assert.ok(Math.abs(half / full - 0.5) < 0.1, `${half} / ${full}`)
})

test('compositor: a hunter without a picture yet is skipped', () => {
  assert.equal(drawn(compose({ dishFrame: () => undefined }).grid), 0)
})

test('compositor: a sick hunter has a frayed edge (some cells dropped, some specks outside), still deterministic', () => {
  const clean = compose({ hunters: [hunter()] }).grid
  const sick = compose({ hunters: [hunter({ fuzz: 1 })] }).grid
  assert.notEqual(drawn(clean), drawn(sick))
  assert.ok(sick.some(c => c && look.fuzz.includes(c.char)), 'specks')
  assert.deepEqual(sick.map(c => c?.char ?? null), compose({ hunters: [hunter({ fuzz: 1 })] }).grid.map(c => c?.char ?? null))
})

test('compositor: a fast hunter is stretched along its motion', () => {
  const still = compose({ hunters: [hunter()] }).grid
  const fast = compose({ hunters: [hunter({ vx: 25 })] }).grid
  const width = g => Math.max(...columnsOf(g, 100)) - Math.min(...columnsOf(g, 100))
  const height = g => Math.max(...rowsOf(g, 100)) - Math.min(...rowsOf(g, 100))
  assert.ok(width(fast) > width(still))
  assert.ok(height(fast) < height(still))
})

test('compositor: colours from the program are kept; plain dishes carry none', () => {
  const frame = { ...solidFrame(), colors: new Array(solidFrame().chars.length).fill('#ff0000'), backs: new Array(solidFrame().chars.length).fill('#000011') }
  const { grid } = compose({ dishFrame: () => frame })
  const cell = grid.find(Boolean)
  assert.equal(cell.color, '#ff0000')
  assert.equal(cell.back, '#000011')
  assert.equal(compose().grid.find(Boolean).color, null)
})

test('compositor: necks fill only empty cells between merging hunters, and nothing otherwise', () => {
  const a = hunter({ id: 1, x: 20, y: 10 })
  const b = hunter({ id: 2, x: 30, y: 10 })
  const hollow = { cols: 87, rows: 20, chars: new Array(87 * 20).fill(' ') } // dishes with nothing in them
  const withLink = composeScreen({ ...baseInput([a, b], hollow), links: [{ ids: [1, 2], thr: 1.2 }] })
  const without = composeScreen({ ...baseInput([a, b], hollow), links: [] })
  assert.equal(drawn(without.grid), 0)
  assert.ok(withLink.neckCells > 20 && drawn(withLink.grid) === withLink.neckCells)
  // a higher threshold means a thinner neck
  const thin = composeScreen({ ...baseInput([a, b], hollow), links: [{ ids: [1, 2], thr: 2.5 }] })
  assert.ok(thin.neckCells < withLink.neckCells)
  // and nothing is drawn over a cell that already has something
  const full = composeScreen({ ...baseInput([a, b], solidFrame()), links: [{ ids: [1, 2], thr: 1.2 }] })
  assert.equal(full.neckCells < withLink.neckCells, true)
})

function baseInput (hunters, frame) {
  return {
    screen: { cols: 100, rows: 30, col0: 0 }, hunters, links: [], cookies: [],
    dishFrame: () => frame, cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(look.cookies), aspect: ASPECT, seconds: 1, look, rng: new Rng(mulberry32(1)),
  }
}

test('compositor: cookies are drawn on top, bold, in an rgb colour, shifted by their shiver, and clipped', () => {
  const cookies = [{ id: 5, x: 20, y: 10 }]
  const calm = compose({ cookies, hunters: [] }).grid
  const cells = calm.filter(Boolean)
  assert.ok(cells.length >= 6 && cells.every(c => c.bold && Array.isArray(c.rgb)))
  const shifted = compose({ cookies, hunters: [], cookieView: () => ({ fear: 1, pulse: 0, shimmer: 0, jx: 2, jy: 1 }) }).grid
  const left = grid => Math.min(...columnsOf(grid, 100))
  assert.equal(left(shifted) - left(calm), 2)
  const edge = compose({ cookies: [{ id: 5, x: 0, y: 0 }], hunters: [] }).grid
  assert.ok(drawn(edge) > 0 && drawn(edge) < cells.length)
  // on top of a hunter
  const over = compose({ cookies, hunters: [hunter({ x: 20, y: 10 })] }).grid
  assert.ok(over.some(c => c && c.bold))
})

test('compositor: the biggest hunter is drawn first so smaller ones stay visible on top', () => {
  const big = hunter({ id: 1, mass: 3, drawMass: 3 })
  const small = hunter({ id: 2, mass: 1 })
  const frames = { 1: { ...solidFrame(30), chars: new Array(solidFrame(30).chars.length).fill('B') }, 2: { ...solidFrame(10), chars: new Array(solidFrame(10).chars.length).fill('s') } }
  const { grid } = compose({ hunters: [small, big], dishFrame: id => frames[id] })
  assert.ok(grid.some(c => c && c.char === 's'))
  assert.ok(grid.some(c => c && c.char === 'B'))
  const centre = grid[Math.round(20 / ASPECT) + 10 * 100]
  assert.equal(centre.char, 's')
})

test('cellHash is steady and spread over [0, 1)', () => {
  assert.equal(cellHash(3, 4, 5), cellHash(3, 4, 5))
  const values = Array.from({ length: 5000 }, (_, i) => cellHash(i % 70, Math.floor(i / 70), 9))
  assert.ok(values.every(v => v >= 0 && v < 1))
  assert.ok(Math.abs(values.reduce((a, b) => a + b) / values.length - 0.5) < 0.03)
})

test('gridToAnsi works on a composed screen', () => {
  const { grid } = compose({ cookies: [{ id: 1, x: 10, y: 5 }] })
  const out = gridToAnsi(grid, 100, 30, { color: 'white', backgroundColor: 'black' })
  assert.equal(out.split('\r\n').length, 30)
})
