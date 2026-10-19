import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Life } from '../src/render/life.mjs'
import { Background } from '../src/render/background.mjs'
import { composeScreen } from '../src/render/compositor.mjs'
import { createCookieStyle } from '../src/render/cookie-style.mjs'
import { Scene } from '../src/saver/scene.mjs'
import { createHunter } from '../src/physics/hunter.mjs'
import { loadConfig } from '../src/config/index.mjs'
import { Rng, mulberry32 } from '../src/core/rng.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'

const lifeSettings = () => structuredClone(DEFAULTS.look.background.life)
const rngOf = seed => new Rng(mulberry32(seed))
const alive = life => life.cells.reduce((a, b) => a + b, 0)
const empty = (cols = 30, rows = 20, over = {}) => {
  const life = new Life({ ...lifeSettings(), ...over }, rngOf(1))
  life.resize(cols, rows)
  life.cells.fill(0)
  life.trail.fill(0)
  return life
}
const cellsOf = life => { const out = []; for (let i = 0; i < life.cells.length; i++) if (life.cells[i]) out.push([i % life.cols, Math.floor(i / life.cols)]); return out }

test('life: the classic rules (a blinker oscillates, a block stays, a lonely cell dies)', () => {
  const life = empty(10, 10, { push: { ...lifeSettings().push, cooldown: 1e9 } })
  for (const [x, y] of [[2, 3], [3, 3], [4, 3]]) life.set(x, y) // blinker
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) life.set(x, y) // block
  life.set(0, 0) // lonely
  life.step()
  assert.deepEqual(cellsOf(life).filter(([x]) => x < 6).map(c => c.join()).sort(), ['3,2', '3,3', '3,4'].sort())
  assert.ok(cellsOf(life).some(([x, y]) => x === 7 && y === 7), 'the block stays')
  assert.ok(!cellsOf(life).some(([x, y]) => x === 0 && y === 0), 'the lonely cell is gone')
})

test('life: the board wraps around, so a glider keeps flying', () => {
  const life = empty(12, 12, { push: { ...lifeSettings().push, cooldown: 1e9 }, minPopulation: 0 })
  life.rng = { ...life.rng, chance: () => false, float: (a) => a }
  life.glider(1, 1)
  const start = alive(life)
  for (let i = 0; i < 80; i++) life.step() // far more than the width: it has gone round the board
  assert.equal(alive(life), start, 'still a glider')
})

test('life: a static board is noticed and pushed, a small push, not a reset', () => {
  const life = empty(60, 30)
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) life.set(x, y) // a block: static forever
  assert.equal(life.pushes, 0)
  for (let i = 0; i < 40; i++) life.step()
  assert.ok(life.pushes >= 1, 'it pushed')
  assert.ok(alive(life) > 4, 'and there is new life: a push adds cells, it does not reset the board')
})

test('life: a dead board is revived; an active board is left alone', () => {
  const dead = empty(60, 30)
  for (let i = 0; i < 20; i++) dead.step()
  assert.ok(dead.pushes >= 1 && alive(dead) > 0)

  const busy = new Life(lifeSettings(), rngOf(5))
  busy.resize(200, 45)
  const before = busy.pushes
  for (let i = 0; i < 5; i++) busy.step()
  assert.equal(busy.pushes, before, 'a lively board does not get pushed')
})

test('life: pushes are spaced by the cooldown', () => {
  const life = empty(60, 30, { push: { ...lifeSettings().push, cooldown: 10 } })
  for (let i = 0; i < 25; i++) life.step()
  assert.ok(life.pushes <= 3, `${life.pushes} pushes in 25 generations`)
})

test('life: over a long time it never goes quiet', () => {
  const life = new Life(lifeSettings(), rngOf(9))
  life.resize(150, 40)
  let quietRun = 0
  let longest = 0
  let previous = ''
  for (let i = 0; i < 3000; i++) {
    life.step()
    const sig = alive(life) + ':' + life.cells.slice(0, 400).join('')
    quietRun = sig === previous ? quietRun + 1 : 0
    previous = sig
    longest = Math.max(longest, quietRun)
  }
  assert.ok(longest < 15, `longest identical stretch: ${longest} generations`)
  assert.ok(alive(life) > 0)
})

test('life: a burst adds live cells around a point, round on screen; trails fade after death', () => {
  const life = empty(100, 40)
  life.burst(50, 20, 6, 1, 0.5)
  const cells = cellsOf(life)
  assert.ok(cells.length > 80)
  const xs = cells.map(c => c[0]); const ys = cells.map(c => c[1])
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1.7 * (Math.max(...ys) - Math.min(...ys)), 'wider in columns than in rows (cells are tall)')
  assert.equal(life.intensity(50, 20), 1)
  assert.equal(life.intensity(-1, 0), 0)
  life.cells.fill(0) // everything dies...
  life.trail.fill(1)
  life.step()
  assert.ok(life.intensity(50, 20) < 1 && life.intensity(50, 20) > 0, '...and fades instead of vanishing')
})

test('life: the same seed plays out the same', () => {
  const run = () => { const l = new Life(lifeSettings(), rngOf(3)); l.resize(80, 30); for (let i = 0; i < 200; i++) l.step(); return l.cells.join('') }
  assert.equal(run(), run())
})

test('life: update() steps by time and does not try to catch up after a stall', () => {
  const life = empty(20, 20)
  life.set(5, 5); life.set(6, 5); life.set(7, 5)
  life.update(0.05)
  assert.equal(life.generation, 0)
  life.update(0.1)
  assert.equal(life.generation, 1)
  life.update(60)
  assert.ok(life.generation <= 4)
})

// ---- the background layer --------------------------------------------------------------------------------

const bgSettings = () => structuredClone(DEFAULTS.look.background)

test('background: neon green, made of the wave characters, dark, and lighter where there are flies', () => {
  const bg = new Background(bgSettings(), rngOf(2))
  bg.resize(100, 40)
  bg.life.cells.fill(0); bg.life.trail.fill(0)
  const clear = bg.cellAt(10, 10, 5)
  assert.ok(bgSettings().pattern.includes(clear.char))
  assert.ok(clear.bg === true)
  assert.ok(clear.rgb[1] > clear.rgb[0] * 3 && clear.rgb[1] > clear.rgb[2] * 3, `green: ${clear.rgb}`)
  bg.life.trail[10 + 10 * 100] = 1 // a fly right there
  assert.ok(clear.rgb[1] <= 60, `the grass is very dark: ${clear.rgb}`)
  const lit = bg.cellAt(10, 10, 5)
  assert.ok(lit.rgb[1] > clear.rgb[1] * 3, 'a fly is lighter than the grass')
  assert.equal(lit.char, clear.char, 'the wave is the same')
})

test('background: the wave drifts slowly and evenly, 5x slower than the original demo, on a three-monitor canvas', () => {
  const bg = new Background(bgSettings(), rngOf(2))
  bg.resize(261, 45)
  const { pattern, speed, warp } = bgSettings()
  assert.equal(speed, 0.5 / 5)
  const phase = (x, y, t) => pattern.indexOf(bg.cellAt(x, y, t).char)
  const shift = (x, y, t0, t1) => ((phase(x, y, t1) - phase(x, y, t0) + 12) % 8) - 4 // the shorter way round
  const worst = 20 * speed * (1 + warp) // characters per second, at the very most
  const step = 0.4
  assert.ok(worst * step < 3, 'the check below is not ambiguous')
  const speeds = {}
  for (const [name, x, y] of [['top-left', 10, 5], ['middle', 130, 22], ['bottom-right', 250, 40]]) {
    let sum = 0; let n = 0
    for (let t = 0; t < 60; t += 1.3) {
      const moved = Math.abs(shift(x, y, t, t + step))
      assert.ok(moved <= Math.ceil(worst * step) + 1, `${name} moved ${moved} characters in ${step}s`)
      sum += moved / step; n++
    }
    speeds[name] = sum / n
    assert.ok(speeds[name] > 0.3, `${name} does move`)
  }
  assert.ok(speeds['bottom-right'] < 3 * speeds['top-left'] + 2, `even: ${JSON.stringify(speeds)}`) // the far corner does not race
})

test('background: cells are shared objects and the palette is small (cheap to print)', () => {
  const bg = new Background(bgSettings(), rngOf(2))
  bg.resize(200, 45)
  const colours = new Set()
  for (let y = 0; y < 45; y++) for (let x = 0; x < 200; x++) colours.add(bg.cellAt(x, y, 3).rgb.join())
  assert.ok(colours.size <= 12)
  assert.ok(bg.cellCache.size <= 8 * 12)
})

function compose (over = {}) {
  const bg = new Background(bgSettings(), rngOf(2))
  bg.resize(100, 30)
  return composeScreen({
    screen: { cols: 100, rows: 30, col0: 0 }, hunters: [], links: [], cookies: [],
    dishFrame: () => undefined, cookieView: () => ({ fear: 0, pulse: 0, shimmer: 0, jx: 0, jy: 0 }),
    cookieShade: createCookieStyle(DEFAULTS.look.cookies), aspect: 0.46, seconds: 1, look: DEFAULTS.look,
    rng: rngOf(1), background: bg, ...over,
  })
}

test('compositor: the background fills every cell; without one nothing is drawn', () => {
  assert.equal(compose().grid.filter(Boolean).length, 3000)
  assert.equal(compose({ background: null }).grid.filter(Boolean).length, 0)
})

test('compositor: a screen further right shows its own part of the background', () => {
  const left = compose({ screen: { cols: 50, rows: 30, col0: 0 } }).grid
  const whole = compose({ screen: { cols: 100, rows: 30, col0: 0 } }).grid
  const right = compose({ screen: { cols: 50, rows: 30, col0: 50 } }).grid
  for (let y = 0; y < 30; y += 7) for (let x = 0; x < 50; x += 5) {
    assert.equal(left[x + y * 50].char, whole[x + y * 100].char)
    assert.equal(right[x + y * 50].char, whole[x + 50 + y * 100].char)
  }
})

test('compositor: hunters are transparent: the grass shows through an empty dish', () => {
  const hunter = { id: 1, x: 23, y: 15, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0 }
  const rows = 20; const cols = Math.round(rows / 0.46)
  const frame = { cols, rows, chars: new Array(cols * rows).fill(' ') } // an empty dish
  const { grid } = compose({ hunters: [hunter], dishFrame: () => frame })
  const centre = grid[Math.round(23 / 0.46) + 15 * 100]
  assert.ok(centre && centre.bg, 'the grass shows inside the dish')
  assert.ok(grid[2 + 2 * 100] && grid[2 + 2 * 100].bg, 'grass far from it')
})

test('compositor: necks draw over the grass', () => {
  const a = { id: 1, x: 20, y: 15, vx: 0, vy: 0, mass: 1, ox: 0, oy: 0, drawMass: 1, alpha: 1, fuzz: 0 }
  const b = { ...a, id: 2, x: 30 }
  const rows = 20; const cols = Math.round(rows / 0.46)
  const frame = { cols, rows, chars: new Array(cols * rows).fill(' ') }
  const { grid, neckCells } = compose({ hunters: [a, b], links: [{ ids: [1, 2], thr: 1.2 }], dishFrame: () => frame })
  assert.ok(neckCells > 10)
  assert.ok(grid.some(c => c && !c.bg && c.color === null), 'neck cells replaced grass cells')
})

// ---- the scene ---------------------------------------------------------------------------------------------

const stubDishes = () => ({ sync () {}, dispatch () {}, frame: () => undefined })
const screens = () => [{ x: 0, name: 'A', cols: 100, rows: 40, aspect: 0.46 }]
const sceneWith = user => {
  const { config } = loadConfig({ env: {}, user: { runtime: { seed: 4 }, ...user } })
  return new Scene({ config, dishes: stubDishes(), programSettings: () => ({ color: 'white', backgroundColor: 'black' }) })
}

test('scene: merges and splits stir the flies where they happen; other events do not', () => {
  const scene = sceneWith({})
  scene.tick(0, 1 / 30, screens())
  const stirs = []
  scene.background.stir = (col, row, radius, density) => stirs.push({ col, row, radius, density })
  const s = scene.world.hunters[0]
  scene.world.log('merge', { keep: s.id, gone: 999, mass: 1 })
  scene.world.log('split', { parent: s.id, pieces: [s.id], masses: [1] })
  scene.world.log('eat', { id: s.id })
  scene.world.log('sick', { id: s.id })
  assert.equal(stirs.length, 2)
  assert.ok(Math.abs(stirs[0].col - s.x / scene.aspect) < 1e-9 && stirs[0].row === s.y)
  assert.ok(stirs[1].radius > stirs[0].radius && stirs[1].density > stirs[0].density, 'a split stirs more than a merge')
})

test('scene: the background can be switched off', () => {
  const scene = sceneWith({ look: { background: { enabled: false } } })
  assert.equal(scene.background, null)
  const out = scene.tick(0, 1 / 30, screens())
  assert.equal(out.length, 1)
})

test('scene: the swarm board covers all screens', () => {
  const scene = sceneWith({})
  scene.tick(0, 1 / 30, [...screens(), { x: 100, name: 'B', cols: 80, rows: 40, aspect: 0.46 }])
  assert.equal(scene.background.life.cols, 180)
  assert.equal(scene.background.life.rows, 40)
})

// ---- the moire ----------------------------------------------------------------------------------------------

const grassLevels = (over, seconds = 7) => {
  const settings = bgSettings()
  Object.assign(settings.moire, over)
  const bg = new Background(settings, rngOf(2))
  bg.resize(261, 45)
  bg.life.cells.fill(0); bg.life.trail.fill(0)
  const levels = []
  for (let y = 0; y < 45; y++) for (let x = 0; x < 261; x++) levels.push(bg.cellAt(x, y, seconds).rgb[1])
  return levels
}
const spread = values => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean }

test('moire: fringes of light and dark cross the grass; with strength 0 there are none', () => {
  const plain = grassLevels({ strength: 0 })
  const moire = grassLevels({ strength: 0.7 })
  assert.ok(spread(moire) > spread(plain) * 1.5, `spread ${spread(moire).toFixed(2)} vs ${spread(plain).toFixed(2)}`)
  assert.ok(Math.max(...moire) > Math.max(...plain) * 0.5 && Math.min(...moire) < Math.max(...moire) * 0.3, 'the fringes reach near black')
})

test('moire: the fringes drift over time, and coherently (neighbouring cells look alike)', () => {
  const a = grassLevels({}, 7)
  const b = grassLevels({}, 12)
  assert.notDeepEqual(a, b)
  let alike = 0
  for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) <= 40) alike++
  assert.ok(alike / a.length > 0.5, `${(100 * alike / a.length).toFixed(0)}% of neighbours alike`)
})

test('moire: the rays fan out from the horizon (the vanishing point), and nothing blows up on it', () => {
  const settings = bgSettings()
  const bg = new Background(settings, rngOf(2))
  bg.resize(261, 45)
  for (let x = 0; x < 261; x++) for (const y of [21, 22, 23]) {
    const cell = bg.cellAt(x, y, 3)
    assert.ok(Number.isFinite(cell.rgb[1]) && settings.pattern.includes(cell.char))
  }
})

test('moire: shifting the characters with the rays is optional and changes what is drawn', () => {
  const chars = shift => { const s = bgSettings(); s.moire.shift = shift; const bg = new Background(s, rngOf(2)); bg.resize(261, 45); return Array.from({ length: 261 }, (_, x) => bg.cellAt(x, 10, 5).char).join('') }
  assert.notEqual(chars(0), chars(0.5))
})

// ---- the moire's vanishing point wanders ----------------------------------------------------------------------

const movingBackground = (seed, over = {}) => {
  const settings = bgSettings()
  Object.assign(settings.moire, over)
  const bg = new Background(settings, rngOf(seed))
  bg.resize(261, 45)
  return bg
}

test('moire centre: it starts somewhere random (not the middle, and not the same every time)', () => {
  const starts = []
  for (let seed = 1; seed <= 12; seed++) starts.push(movingBackground(seed).moireCentre().map(Math.round))
  assert.ok(new Set(starts.map(s => s.join())).size >= 10, 'different starting places')
  assert.ok(starts.every(([x, y]) => x >= 26 && x <= 235 && y >= 9 && y <= 36), 'on screen, away from the edges')
  assert.ok(starts.filter(([x]) => Math.abs(x - 130) < 6).length < 4, 'not always in the middle')
  const a = movingBackground(5).moireCentre()
  const b = movingBackground(5).moireCentre()
  assert.deepEqual(a, b, 'but the same for the same seed')
})

test('moire centre: it drifts slowly and smoothly, and over a few minutes it covers a good part of the screen', () => {
  const bg = movingBackground(3)
  let last = bg.moireCentre()
  const start = last
  let biggest = 0
  const xs = []
  for (let f = 0; f < 30 * 180; f++) {
    bg.update(1 / 30)
    const now = bg.moireCentre()
    biggest = Math.max(biggest, Math.hypot(now[0] - last[0], now[1] - last[1]))
    last = now
    xs.push(now[0])
    if (f === 29) assert.ok(Math.hypot(now[0] - start[0], now[1] - start[1]) < 6, 'a second later it has hardly moved')
  }
  assert.ok(biggest < 0.3, `the biggest move in one frame is ${biggest.toFixed(2)} cells`)
  assert.ok(Math.max(...xs) - Math.min(...xs) > 50, `it covered ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)} columns in 3 minutes`)
})

test('moire centre: it never leaves the screen (it turns back at the edges) and never jumps, over ten minutes', () => {
  for (const seed of [1, 2, 3]) {
    const bg = movingBackground(seed, { drift: 6 }) // quicker, to reach the edges
    let last = bg.moireCentre()
    for (let f = 0; f < 30 * 600; f++) {
      bg.update(1 / 30)
      const [x, y] = bg.moireCentre()
      assert.ok(x > 5 && x < 256 && y > 2 && y < 43, `seed ${seed}: left the screen at ${x.toFixed(0)}, ${y.toFixed(0)}`)
      assert.ok(Math.hypot(x - last[0], y - last[1]) < 0.4, 'jumped')
      last = [x, y]
    }
  }
})

test('moire centre: with drift 0 it stays where `horizon` says, in the middle of the width', () => {
  const bg = movingBackground(4, { drift: 0, horizon: 0.3 })
  for (let f = 0; f < 300; f++) bg.update(1 / 30)
  const [x, y] = bg.moireCentre()
  assert.ok(Math.abs(x - 130.5) < 1e-9 && Math.abs(y - 45 * 0.3) < 1e-9)
})

test('moire centre: the fringes follow it: the pattern changes as it moves, and differs for another start', () => {
  const picture = bg => Array.from({ length: 261 }, (_, x) => bg.cellAt(x, 5, 9).rgb[1]).join()
  const bg = movingBackground(2)
  const before = picture(bg)
  for (let f = 0; f < 30 * 60; f++) bg.update(1 / 30)
  assert.notEqual(picture(bg), before)
  assert.notEqual(picture(movingBackground(8)), picture(movingBackground(9)))
})

test('moire centre: the scene moves it along with the frames', () => {
  const scene = sceneWith({})
  scene.tick(0, 1 / 30, screens())
  const before = scene.background.moireCentre()
  for (let i = 1; i < 300; i++) scene.tick(i * 33, 1 / 30, screens())
  const after = scene.background.moireCentre()
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 3, 'it moved in 10 seconds')
})
