import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installPlayCoreHooks, playCoreDir } from '../src/play/module-hooks.mjs'
import { installBrowserShims } from '../src/play/browser-shims.mjs'
import { ProgramHost, createMetrics, DEFAULT_SETTINGS } from '../src/play/program-host.mjs'
import { ProgramInstance } from '../src/play/instance.mjs'
import { deepClone } from '../src/play/clone.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'slime-play-'))
const write = (dir, name, text) => { const p = join(dir, name); writeFileSync(p, text); return p }

// ---- module hooks -------------------------------------------------------------------------------

test("module hooks resolve '/src/...' imports inside a play.core checkout", async () => {
  const fakeCore = tmp()
  mkdirSync(join(fakeCore, 'src', 'modules'), { recursive: true })
  writeFileSync(join(fakeCore, 'src', 'modules', 'helper.js'), 'export const answer = 42\n')
  const program = write(tmp(), 'uses-helper.js', "import { answer } from '/src/modules/helper.js'\nexport const value = answer\n")
  installPlayCoreHooks(fakeCore)
  const module = await import(pathToFileURL(program).href)
  assert.equal(module.value, 42)
})

test('module hooks explain what is wrong when play.core is not installed', async () => {
  const program = write(tmp(), 'needs-core.js', "import { x } from '/src/modules/missing.js'\nexport const y = x\n")
  installPlayCoreHooks(join(tmp(), 'nowhere'))
  await assert.rejects(import(pathToFileURL(program).href), /play\.core is not installed.*fetch-play-core/s)
})

test('playCoreDir: PLAY_CORE_DIR wins, otherwise vendor/play.core in the project', () => {
  assert.equal(playCoreDir({ PLAY_CORE_DIR: '/x' }), '/x')
  assert.ok(playCoreDir({}).endsWith('/vendor/play.core'))
})

test('browser shims make the usual DOM touches harmless', () => {
  const target = {}
  installBrowserShims(target)
  target.document.body.style.cursor = 'crosshair'
  assert.equal(target.document.querySelector('x'), null)
  assert.equal(typeof target.requestAnimationFrame, 'function')
  assert.equal(target.window, target)
})

// ---- the program host ----------------------------------------------------------------------------

test('metrics: a cell is as wide as it is tall times the aspect', () => {
  const m = createMetrics(0.5)
  assert.equal(m.aspect, 0.5)
  assert.equal(m.lineHeight, 2)
})

test('ProgramHost loads a program and its settings, and reloads it after an edit', async () => {
  const dir = tmp()
  const file = write(dir, 'p.js', "export const settings = { fps: 12 }\nexport const version = 1\n")
  const host = new ProgramHost(file, { aspect: 0.4 })
  await host.load()
  assert.equal(host.module.version, 1)
  assert.equal(host.settings.fps, 12)
  assert.equal(host.settings.color, DEFAULT_SETTINGS.color) // defaults fill the gaps
  writeFileSync(file, "export const settings = { fps: 60 }\nexport const version = 2\n")
  await host.load()
  assert.equal(host.module.version, 2)
  assert.equal(host.settings.fps, 60)
  host.setAspect(0.6)
  assert.equal(host.metrics.aspect, 0.6)
  assert.equal(host.metrics.lineHeight, 1 / 0.6)
})

// ---- running instances ---------------------------------------------------------------------------

function fakeHost (module, aspect = 0.5) {
  return { module, settings: { ...DEFAULT_SETTINGS, ...module.settings }, metrics: createMetrics(aspect) }
}

test('an instance calls boot, then pre, main for every cell, and post, in that order', () => {
  const calls = []
  const host = fakeHost({
    boot: () => calls.push('boot'),
    pre: () => calls.push('pre'),
    main: coord => { calls.push('main'); return String(coord.index % 10) },
    post: () => calls.push('post'),
  })
  const inst = new ProgramInstance(host, { frame: 0 })
  inst.resize(3, 2)
  inst.step(100)
  assert.deepEqual(calls, ['boot', 'pre', 'main', 'main', 'main', 'main', 'main', 'main', 'post'])
  assert.deepEqual(inst.snapshot().chars, ['0', '1', '2', '3', '4', '5'])
  inst.step(133)
  assert.equal(calls.filter(c => c === 'boot').length, 1, 'boot only once')
  assert.equal(inst.frame, 2)
  assert.equal(inst.time, 133)
})

test('main receives coord, context, cursor, buffer and the program data', () => {
  let seen = null
  const host = fakeHost({
    boot: (context, buffer, data) => { data.hello = 'world' },
    main: (coord, context, cursor, buffer, data) => { seen = { coord, context, cursor, buffer, data }; return 'x' },
  }, 0.46)
  const inst = new ProgramInstance(host, { frame: 7 })
  inst.resize(4, 3)
  inst.step(50)
  assert.deepEqual(seen.coord.x !== undefined && seen.coord.y !== undefined && seen.coord.index !== undefined, true)
  assert.equal(seen.context.cols, 4)
  assert.equal(seen.context.rows, 3)
  assert.equal(seen.context.metrics.aspect, 0.46)
  assert.equal(seen.context.frame, 8)
  assert.equal(seen.context.time, 50)
  assert.equal(seen.context.width, 4 * seen.context.metrics.cellWidth)
  assert.equal(seen.cursor.pressed, false)
  assert.equal(seen.data.hello, 'world')
  assert.equal(seen.buffer.length, 12)
  assert.throws(() => { seen.context.cols = 9 }, TypeError, 'the context is frozen')
})

test('resize rebuilds the buffer only when the size changes; boot waits for a size', () => {
  const host = fakeHost({ main: () => 'a' })
  const inst = new ProgramInstance(host, { frame: 0 })
  inst.boot()
  assert.equal(inst.booted, false)
  assert.equal(inst.resize(5, 4), true)
  assert.equal(inst.resize(5, 4), false)
  assert.equal(inst.buffer.length, 20)
  assert.equal(inst.resize(2, 2), true)
  assert.equal(inst.buffer.length, 4)
})

test('main may return an object to set colours; empty results become spaces', () => {
  const host = fakeHost({ main: c => (c.index === 0 ? { char: 'R', color: 'red' } : c.index === 1 ? '' : null) })
  const inst = new ProgramInstance(host, { frame: 0 })
  inst.resize(3, 1)
  inst.step(0)
  const snap = inst.snapshot()
  assert.deepEqual(snap.chars, ['R', ' ', ' '])
  assert.equal(snap.colors[0], 'red')
  assert.equal(snap.colors[1], 'white')
})

test('the snapshot only carries colours if the program used any', () => {
  const plain = new ProgramInstance(fakeHost({ main: () => 'a' }), { frame: 0 })
  plain.resize(2, 2)
  plain.step(0)
  assert.equal(plain.snapshot().colors, undefined)
  assert.equal(plain.snapshot().cols, 2)
})

test('instances of one program do not share data, and start out of step with each other', () => {
  let counter = 0
  const host = fakeHost({ boot: (c, b, data) => { data.n = ++counter }, main: () => 'a' })
  const a = new ProgramInstance(host)
  const b = new ProgramInstance(host)
  a.resize(2, 2); b.resize(2, 2); a.step(0); b.step(0)
  assert.notEqual(a.data.n, b.data.n)
  assert.notEqual(new ProgramInstance(host, { random: () => 0.1 }).frame, new ProgramInstance(host, { random: () => 0.9 }).frame)
})

test('a clone continues from the same state but is independent', () => {
  class Agent { constructor () { this.pos = { x: 1, y: 2 } } move () { this.pos.x += 1; return this.pos.x } }
  const host = fakeHost({
    boot: (c, b, data) => { data.agent = new Agent(); data.field = new Float32Array([1, 2, 3]) },
    pre: (c, cur, b, data) => { data.agent.move(); data.field[0] += 1 },
    main: (coord, c, cur, b, data) => String(data.agent.pos.x % 10),
  })
  const a = new ProgramInstance(host, { frame: 5 })
  a.resize(2, 1)
  a.step(0)
  a.step(1)
  const b = a.clone()
  assert.equal(b.frame, a.frame)
  assert.ok(b.data.agent instanceof Agent, 'class instances keep their methods')
  assert.notEqual(b.data.agent, a.data.agent)
  assert.deepEqual(b.snapshot(), a.snapshot())
  b.step(2) // the clone moves on...
  assert.equal(a.data.agent.pos.x, 3) // ...the original does not
  assert.equal(b.data.agent.pos.x, 4)
  assert.equal(a.data.field[0], 3)
  assert.equal(b.data.field[0], 4)
  a.step(2)
  assert.deepEqual(b.snapshot(), a.snapshot(), 'and both agree again when stepped the same')
})

// ---- deepClone -----------------------------------------------------------------------------------

test('deepClone copies plain data, arrays, typed arrays, Maps and Sets', () => {
  const source = { a: [1, { b: 2 }], t: new Float32Array([1.5, 2.5]), m: new Map([['k', { v: 1 }]]), s: new Set([1, 2]), n: null, u: undefined, str: 'x' }
  const copy = deepClone(source)
  assert.deepEqual(copy, source)
  assert.notEqual(copy.a, source.a)
  assert.notEqual(copy.a[1], source.a[1])
  assert.notEqual(copy.t, source.t)
  copy.t[0] = 9
  assert.equal(source.t[0], 1.5)
  assert.notEqual(copy.m.get('k'), source.m.get('k'))
})

test('deepClone keeps shared and circular references, and class prototypes', () => {
  class P { hi () { return 'hi' } }
  const shared = { x: 1 }
  const source = { a: shared, b: shared, p: new P() }
  source.self = source
  const copy = deepClone(source)
  assert.equal(copy.a, copy.b)
  assert.notEqual(copy.a, shared)
  assert.equal(copy.self, copy)
  assert.equal(copy.p.hi(), 'hi')
  assert.ok(copy.p instanceof P)
})

test('deepClone shares functions instead of copying them', () => {
  const fn = () => 1
  assert.equal(deepClone({ fn }).fn, fn)
})
