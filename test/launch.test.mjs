import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Scene } from '../src/saver/scene.mjs'
import { loadConfig } from '../src/config/index.mjs'
import { createHunter } from '../src/physics/hunter.mjs'
import { emptyWorld, run } from './helpers.mjs'

const sceneWith = (user = {}) => {
  const { config } = loadConfig({ env: {}, user: { runtime: { seed: 7 }, ...user } })
  const logs = []
  const dishes = { sync () {}, dispatch () {}, frame: () => undefined }
  return { scene: new Scene({ config, dishes, programSettings: () => ({ color: 'white', backgroundColor: 'black' }), log: m => logs.push(m) }), logs }
}
// three windows, as the clients report them: sizes first, the measured character shape a moment later
const windows = (aspect, size = [174, 45]) => [0, 1, 2].map(i => ({ x: i * 2560, name: 'D' + i, cols: size[0], rows: size[1], aspect }))
const columns = scene => scene.world.hunters.map(s => [s.id, (s.x + s.ox) / scene.aspect, s.y + s.oy]) // where each is drawn (a merge moves the body's coordinates, not the drawing)

test('launch: until every window has measured its character shape there are no hunters, only the background', () => {
  const { scene } = sceneWith()
  for (let f = 0; f < 40; f++) {
    const out = scene.tick(f * 33, 1 / 30, windows(0))
    assert.equal(out.length, 3, 'the windows are not left blank')
    assert.ok(out[0].frame.length > 1000, 'a frame of grass')
  }
  assert.equal(scene.world.hunters.length, 0)
  assert.equal(scene.settled, false)
})

test('launch: when the shape is measured the hunters appear, and from then on they do not slide sideways', () => {
  const { scene } = sceneWith()
  for (let f = 0; f < 44; f++) scene.tick(f * 33, 1 / 30, windows(0))
  scene.tick(44 * 33, 1 / 30, windows(0.46)) // 1.5 s after the start the clients measure the shape
  assert.ok(scene.settled && scene.world.hunters.length > 0)
  assert.ok(Math.abs(scene.world.w - 522 * 0.46) < 1e-6, 'the area is the real one, from the first frame')
  let previous = columns(scene)
  for (let f = 45; f < 45 + 90; f++) {
    scene.tick(f * 33, 1 / 30, windows(0.46))
    const now = columns(scene)
    for (const [id, col, row] of now) {
      const was = previous.find(p => p[0] === id)
      if (!was) continue // new since the last frame (a piece of a split, say)
      const [, pc, pr] = was
      const shortWay = (d, size) => Math.min(Math.abs(d), size - Math.abs(d)) // (the world wraps around)
      const jump = Math.hypot(shortWay(col - pc, 522), shortWay(row - pr, 45))
      assert.ok(jump < 6, `hunter ${id} jumped ${jump.toFixed(1)} cells at frame ${f}`) // (fast ones cover a few cells per frame)
    }
    previous = now
  }
})

test('launch: a transitional window size (48x15) at first does not leave hunters stranded in a tiny world', () => {
  const { scene } = sceneWith()
  const early = [{ x: 0, name: 'D0', cols: 48, rows: 15, aspect: 0 }, ...windows(0).slice(1)]
  for (let f = 0; f < 10; f++) scene.tick(f * 33, 1 / 30, early)
  assert.equal(scene.world.hunters.length, 0, 'nothing is placed from a size that is about to change')
  scene.tick(11 * 33, 1 / 30, windows(0.46))
  assert.equal(scene.world.h, 45)
  assert.ok(scene.world.hunters.every(s => s.y >= 0 && s.y <= 45))
  assert.ok(scene.world.hunters.some(s => s.y > 25), 'they are spread over the real height')
})

test('launch: where the shape cannot be measured, the hunters still appear after a while', () => {
  const { scene } = sceneWith({ runtime: { settleMs: 1000, seed: 7 } })
  scene.tick(0, 1 / 30, windows(0))
  scene.tick(900, 1 / 30, windows(0))
  assert.equal(scene.world.hunters.length, 0)
  scene.tick(1100, 1 / 30, windows(0))
  assert.ok(scene.world.hunters.length > 0)
  assert.ok(Math.abs(scene.aspect - 0.5) < 1e-9, 'with the default shape')
})

test('launch: the starting hunters fade in, steadily, and then are fully there', () => {
  const { scene } = sceneWith({ runtime: { introMs: 1000, seed: 7 }, physics: { hunting: { stalk: { drive: 0 } } } }) // (nobody hunting: the fade is all that happens)
  const alphas = []
  let watched = null
  for (let f = 0; f < 60; f++) {
    scene.tick(f * 33, 1 / 30, windows(0.46))
    watched ??= scene.world.hunters[0]?.id
    const s = scene.world.hunters.find(h => h.id === watched)
    if (s && !s.anim) alphas.push(s.alpha) // (a hunter caught in a merge dissolves, which is another story)
  }
  assert.ok(alphas[0] < 0.1, `starts at ${alphas[0]}`)
  assert.ok(alphas.every((a, i) => i === 0 || a >= alphas[i - 1] - 1e-9), 'steadily')
  assert.equal(alphas.at(-1), 1)
  assert.ok(scene.world.hunters.filter(s => !s.anim).every(s => s.alpha === 1))
})

test('launch: a later change of layout carries the hunters along instead of leaving them behind', () => {
  const { scene } = sceneWith()
  for (let f = 0; f < 5; f++) scene.tick(f * 33, 1 / 30, windows(0.46))
  const before = columns(scene)
  for (let f = 5; f < 8; f++) scene.tick(f * 33, 1 / 30, windows(0.5)) // the shape changes after all (another monitor, another font)
  const after = columns(scene)
  for (const [id, col] of after) {
    const [, was] = before.find(b => b[0] === id)
    assert.ok(Math.abs(col - was) < 8, `hunter ${id} was at column ${was.toFixed(0)}, now ${col.toFixed(0)}`)
  }
})

test('world: when the area changes under living hunters they keep their places, and their size eases to the new one', () => {
  const world = emptyWorld({ motion: { wander: 0 } })
  const s = createHunter(world, 120, 22.5, 1)
  world.hunters.push(s)
  world.cookies.push({ id: 900, x: 60, y: 11.25, born: 0 })
  const r0 = world.r0
  world.setSpace(world.w * 2, world.h / 2, r0 * 2, [])
  assert.ok(Math.abs(s.x - 240) < 1e-9 && Math.abs(s.y - 11.25) < 1e-9, `moved to ${s.x}, ${s.y}`)
  assert.ok(Math.abs(world.cookies[0].x - 120) < 1e-9)
  assert.equal(world.r0, r0, 'the size has not jumped')
  run(world, 0.1)
  assert.ok(world.r0 > r0 && world.r0 < r0 * 2, 'it is on its way')
  run(world, 3)
  assert.ok(Math.abs(world.r0 - r0 * 2) < 0.05 * r0, 'and gets there')
})
