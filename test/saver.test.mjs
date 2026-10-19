import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MSG, encode, LineDecoder } from '../src/saver/protocol.mjs'
import { arrangeScreens, measuredAspect } from '../src/saver/screens.mjs'
import { ScreenHub } from '../src/saver/screen-hub.mjs'
import { DishRegistry } from '../src/saver/dish-registry.mjs'
import { Scene } from '../src/saver/scene.mjs'
import { loadConfig } from '../src/config/index.mjs'
import { createHunter } from '../src/physics/hunter.mjs'
import { createNullPlatform, createHyprlandPlatform, detectPlatform } from '../src/platform/hyprland.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---- protocol ----------------------------------------------------------------------------------------

test('protocol: messages survive being split across chunks, and garbage is skipped', () => {
  const decoder = new LineDecoder()
  const text = encode({ t: MSG.HELLO, x: 5, name: 'DP-1', cols: 10, rows: 4 }) + 'not json\n' + encode({ t: MSG.QUIT })
  assert.deepEqual(decoder.push(text.slice(0, 7)), [])
  const messages = decoder.push(text.slice(7))
  assert.equal(messages.length, 2)
  assert.equal(messages[0].name, 'DP-1')
  assert.equal(messages[1].t, MSG.QUIT)
  assert.equal(encode({ a: 1 }), '{"a":1}\n')
})

test('protocol: a frame full of escape codes round-trips', () => {
  const frame = '\x1b[H\x1b[38;2;1;2;3mabc\r\n\x1b[0m'
  const [m] = new LineDecoder().push(encode({ t: MSG.FRAME, d: frame }))
  assert.equal(m.d, frame)
})

// ---- screens -----------------------------------------------------------------------------------------

test('arrangeScreens: left to right by position, with running column offsets and the smallest height', () => {
  const screens = [
    { x: 2560, name: 'B', cols: 100, rows: 40, aspect: 0 },
    { x: 0, name: 'A', cols: 80, rows: 45, aspect: 0 },
    { x: 5120, name: 'C', cols: 0, rows: 0, aspect: 0 }, // has not reported a size yet
  ]
  const { screens: ready, totalCols, rows } = arrangeScreens(screens)
  assert.deepEqual(ready.map(s => s.name), ['A', 'B'])
  assert.deepEqual(ready.map(s => s.col0), [0, 80])
  assert.equal(totalCols, 180)
  assert.equal(rows, 40)
  assert.deepEqual(arrangeScreens([]), { screens: [], totalCols: 0, rows: 0 })
})

test('measuredAspect: the average of what the windows measured, else the fallback', () => {
  assert.equal(measuredAspect([{ aspect: 0 }, { aspect: 0 }], 0.5), 0.5)
  assert.equal(measuredAspect([{ aspect: 0.46 }, { aspect: 0.4601 }, { aspect: 0 }], 0.5), 0.46)
})

// ---- the hub, over a real unix socket --------------------------------------------------------------

test('hub: clients say hello, report sizes, receive frames, and can ask everybody to stop', async () => {
  const socketPath = join(mkdtempSync(join(tmpdir(), 'slime-hub-')), 'hub.sock')
  const hub = new ScreenHub({ socketPath })
  hub.listen()
  await sleep(50)

  const connect = () => new Promise(resolve => {
    const socket = net.connect(socketPath, () => resolve({ socket, decoder: new LineDecoder(), received: [] }))
  })
  const a = await connect()
  const b = await connect()
  for (const c of [a, b]) {
    c.socket.setEncoding('utf8')
    c.socket.on('data', chunk => c.received.push(...c.decoder.push(chunk)))
  }
  a.socket.write(encode({ t: MSG.HELLO, x: 0, name: 'A', cols: 80, rows: 24 }))
  b.socket.write(encode({ t: MSG.HELLO, x: 100, name: 'B', cols: 90, rows: 30 }))
  await sleep(50)
  assert.equal(hub.readyCount, 2)
  const [first] = [...hub.clients]
  assert.ok(first.cols > 0 && first.name)

  b.socket.write(encode({ t: MSG.SIZE, cols: 95, rows: 31 }) + encode({ t: MSG.ASPECT, v: 0.47 }))
  await sleep(50)
  const clientB = [...hub.clients].find(c => c.name === 'B')
  assert.equal(clientB.cols, 95)
  assert.equal(clientB.aspect, 0.47)

  hub.sendFrame(clientB, 'FRAME-1')
  await sleep(50)
  assert.deepEqual(b.received.filter(m => m.t === MSG.FRAME).map(m => m.d), ['FRAME-1'])
  assert.equal(a.received.filter(m => m.t === MSG.FRAME).length, 0)

  let quitRequested = false
  hub.on('quit', () => { quitRequested = true })
  a.socket.write(encode({ t: MSG.QUIT }))
  await sleep(50)
  assert.equal(quitRequested, true)
  hub.stopAll()
  await sleep(50)
  assert.ok(a.received.some(m => m.t === MSG.STOP) && b.received.some(m => m.t === MSG.STOP))

  let empty = false
  hub.on('empty', () => { empty = true })
  a.socket.end(); b.socket.end()
  await sleep(100)
  assert.equal(empty, true)
  hub.close()
})

// ---- the dish registry, with a fake worker pool ----------------------------------------------------

function fakePool (size = 2) {
  const calls = []
  return {
    size,
    calls,
    busy: new Set(),
    canStep (w) { return !this.busy.has(w) },
    step (w, jobs, aspect) { calls.push(['step', w, jobs, aspect]) },
    clone (w, from, to) { calls.push(['clone', w, from, to]) },
    drop (ids) { calls.push(['drop', ids]) },
  }
}

test('dish registry: a dish per hunter, window sizes ease toward the drawn size, jobs go to the right workers', () => {
  const pool = fakePool(2)
  const registry = new DishRegistry({ pool, pad: 1 })
  const hunters = [{ id: 1, drawMass: 1, bornFrom: 0 }, { id: 2, drawMass: 4, bornFrom: 0 }]
  registry.sync(hunters, 20)
  registry.dispatch(100, 0.5)
  const steps = pool.calls.filter(c => c[0] === 'step')
  assert.equal(steps.length, 2) // one job list per worker
  const jobs = Object.fromEntries(steps.flatMap(c => c[2]).map(j => [j.id, j]))
  assert.equal(jobs[1].rows, 20)
  assert.equal(jobs[1].cols, 40) // rows / aspect
  assert.equal(jobs[2].rows, 40) // sqrt(4) * 20
  assert.notEqual(steps[0][1], steps[1][1], 'the two dishes are on different workers')

  // a hunter that grows: the window eases toward the new size, it does not jump
  hunters[0].drawMass = 4
  registry.sync(hunters, 20)
  const size = registry.dishes.get(1).size
  assert.ok(size > 20 && size < 40)
})

test('dish registry: a split piece starts as a copy of its parent, on the same worker, showing the parent picture', () => {
  const pool = fakePool(3)
  const registry = new DishRegistry({ pool, pad: 1 })
  registry.sync([{ id: 1, drawMass: 1, bornFrom: 0 }], 20)
  registry.receive([{ id: 1, cols: 10, rows: 10, chars: ['x'] }])
  registry.sync([{ id: 1, drawMass: 1, bornFrom: 0 }, { id: 2, drawMass: 1, bornFrom: 1 }], 20)
  assert.deepEqual(pool.calls.find(c => c[0] === 'clone'), ['clone', registry.dishes.get(1).worker, 1, 2])
  assert.equal(registry.dishes.get(2).worker, registry.dishes.get(1).worker)
  assert.equal(registry.frame(2), registry.frame(1), 'it shows the parent picture until its own arrives')
})

test('dish registry: hunters that are gone lose their dishes; a busy worker is skipped; unknown results are ignored', () => {
  const pool = fakePool(1)
  const registry = new DishRegistry({ pool, pad: 1 })
  registry.sync([{ id: 1, drawMass: 1, bornFrom: 0 }, { id: 2, drawMass: 1, bornFrom: 0 }], 20)
  registry.sync([{ id: 2, drawMass: 1, bornFrom: 0 }], 20)
  assert.deepEqual(pool.calls.find(c => c[0] === 'drop'), ['drop', [1]])
  assert.equal(registry.frame(1), undefined)
  pool.busy.add(0)
  registry.dispatch(0, 0.5)
  assert.equal(pool.calls.filter(c => c[0] === 'step').length, 0)
  registry.receive([{ id: 99, cols: 1, rows: 1, chars: ['x'] }]) // nobody has dish 99: no error
})

// ---- the scene, with a stub registry ----------------------------------------------------------------

function stubDishes () {
  return {
    frames: new Map(),
    synced: 0,
    dispatched: 0,
    sync (hunters, baseRows) {
      this.synced++
      this.baseRows = baseRows
      for (const s of hunters) {
        const rows = Math.max(6, Math.round(baseRows * Math.sqrt(s.drawMass) * 1.15))
        const cols = Math.round(rows / 0.5)
        this.frames.set(s.id, { cols, rows, chars: new Array(cols * rows).fill('#') })
      }
    },
    dispatch () { this.dispatched++ },
    frame (id) { return this.frames.get(id) },
  }
}

const sceneFor = (patch = {}) => {
  const { config } = loadConfig({ env: {}, user: { runtime: { seed: 3 }, ...patch } })
  const dishes = stubDishes()
  return { scene: new Scene({ config, dishes, programSettings: () => ({ color: 'white', backgroundColor: 'black' }) }), dishes }
}
const screens = () => [
  { x: 0, name: 'A', cols: 100, rows: 40, aspect: 0.46 },
  { x: 100, name: 'B', cols: 100, rows: 40, aspect: 0.46 },
]

test('scene: one frame per screen that has reported a size, and nothing before any has', () => {
  const { scene, dishes } = sceneFor()
  assert.deepEqual(scene.tick(0, 1 / 30, []), [])
  assert.deepEqual(scene.tick(0, 1 / 30, [{ x: 0, name: 'A', cols: 0, rows: 0, aspect: 0 }]), [])
  const out = scene.tick(33, 1 / 30, screens())
  assert.equal(out.length, 2)
  for (const { screen, frame } of out) {
    assert.equal(frame.split('\r\n').length, screen.rows)
    assert.ok(frame.startsWith('\x1b[H'))
  }
  assert.equal(dishes.synced, 1)
  assert.equal(dishes.dispatched, 1)
})

test('scene: the world covers all screens, sized from their height and the measured cell shape', () => {
  const { scene } = sceneFor()
  scene.tick(0, 1 / 30, screens())
  assert.equal(scene.aspect, 0.46)
  assert.ok(Math.abs(scene.world.w - 200 * 0.46) < 1e-9)
  assert.equal(scene.world.h, 40)
  assert.equal(scene.baseRows, Math.round(scene.config.look.baseSize * 40))
  assert.equal(scene.world.hunters.length, scene.config.physics.hunters.count)
})

test('scene: dishes are drawn where the hunters are, and the frames show them', () => {
  const { scene } = sceneFor()
  const frames = []
  for (let i = 0; i < 60; i++) frames.push(...scene.tick(i * 33, 1 / 30, screens()).map(o => o.frame)) // cookies appear after half a second
  assert.ok(frames.some(f => f.includes('#')), 'some dish characters on screen')
  assert.ok(frames.some(f => f.includes('\x1b[1m')), 'and, at some point, bold cookies (the hunters eat them quickly)')
})

test('scene: with the same seed two scenes play out the same, and the speed setting speeds up the physics', () => {
  const a = sceneFor().scene
  const b = sceneFor().scene
  for (let i = 0; i < 100; i++) { a.tick(i * 33, 1 / 30, screens()); b.tick(i * 33, 1 / 30, screens()) }
  assert.equal(JSON.stringify(a.world.hunters.map(s => [s.x, s.y])), JSON.stringify(b.world.hunters.map(s => [s.x, s.y])))
  const fast = sceneFor({ runtime: { speed: 5 } }).scene
  fast.tick(0, 1 / 30, screens())
  fast.tick(33, 1 / 30, screens())
  assert.ok(Math.abs(fast.world.t - 2 * 5 / 30) < 1e-9)
})

test('scene: describe() summarises the state for the debug log', () => {
  const { scene } = sceneFor()
  scene.tick(0, 1 / 30, screens())
  assert.match(scene.describe(), /hunters=\d+ cookies=\d+ hunting=\d+ .*masses=/)
})

test('scene: a hunter that was split off gets its parent dish registered (the registry sees bornFrom)', () => {
  const { scene } = sceneFor()
  scene.tick(0, 1 / 30, screens())
  const parent = scene.world.hunters[0]
  const piece = createHunter(scene.world, parent.x, parent.y, 0.5)
  piece.bornFrom = parent.id
  scene.world.hunters.push(piece)
  const seen = []
  const sync = scene.dishes.sync.bind(scene.dishes)
  scene.dishes.sync = hunters => { seen.push(...hunters.filter(s => s.bornFrom).map(s => s.bornFrom)); sync(hunters, scene.baseRows) }
  scene.tick(33, 1 / 30, screens())
  assert.ok(seen.includes(parent.id))
})

// ---- the platforms --------------------------------------------------------------------------------------

test('platforms: the null platform claims nothing; Hyprland is picked only inside Hyprland', () => {
  const none = createNullPlatform()
  assert.equal(none.hasFocus(), null)
  assert.equal(none.measureAspect(80, 24), null)
  assert.equal(detectPlatform({ windowClass: 'x', env: {} }).name, 'none')
  assert.equal(detectPlatform({ windowClass: 'x', env: { HYPRLAND_INSTANCE_SIGNATURE: 'abc' } }).name, 'hyprland')
  // without a running Hyprland, hyprctl fails (or is missing): the answer is "unknown", not an error
  const hypr = createHyprlandPlatform({ windowClass: 'x' })
  assert.ok([null, false, true].includes(hypr.hasFocus()))
})
