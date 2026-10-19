// End to end: the real scene process, with real worker threads running a real (tiny) play.core program,
// talking to fake display clients over the real unix socket.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MSG, encode, LineDecoder } from '../src/saver/protocol.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function fakeClient (socketPath, hello) {
  return new Promise((resolve, reject) => {
    const client = { frames: [], stopped: false, socket: null }
    const decoder = new LineDecoder()
    const socket = net.connect(socketPath, () => {
      socket.write(encode({ t: MSG.HELLO, ...hello }))
      socket.write(encode({ t: MSG.ASPECT, v: 0.46 }))
      resolve(client)
    })
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      for (const m of decoder.push(chunk)) {
        if (m.t === MSG.FRAME) client.frames.push(m.d)
        if (m.t === MSG.STOP) client.stopped = true
      }
    })
    socket.on('error', reject)
    client.socket = socket
  })
}

async function connectWhenReady (socketPath, hello) {
  for (let i = 0; i < 50; i++) {
    try { return await fakeClient(socketPath, hello) } catch { await sleep(100) }
  }
  throw new Error('the scene never opened its socket')
}

test('the scene process runs the simulation and serves frames to every screen, then stops on request', { timeout: 30000 }, async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'slime-e2e-'))
  const scene = spawn(process.execPath, [join(ROOT, 'bin', 'slime-saver-scene'), join(ROOT, 'test', 'fixtures', 'disc.js'), '--expect', '2'], {
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir, SLIME_SAVER_SEED: '7', SLIME_SAVER_WORKERS: '2', SLIME_SAVER_SPEED: '3', SLIME_SAVER_CONFIG: '/nonexistent.json' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  scene.stderr.on('data', d => { stderr += d })
  const exited = new Promise(resolve => scene.on('exit', (code, signal) => resolve({ code, signal })))

  try {
    const socketPath = join(runtimeDir, 'slime-saver.sock')
    const left = await connectWhenReady(socketPath, { x: 0, name: 'LEFT', cols: 100, rows: 40 })
    const right = await connectWhenReady(socketPath, { x: 2560, name: 'RIGHT', cols: 100, rows: 40 })
    await sleep(2500)

    for (const [name, client] of [['left', left], ['right', right]]) {
      assert.ok(client.frames.length >= 20, `${name}: ${client.frames.length} frames in 2.5 s`)
      const frame = client.frames.at(-1)
      assert.ok(frame.startsWith('\x1b[H'), `${name}: a frame starts by homing the cursor`)
      assert.equal(frame.split('\r\n').length, 40, `${name}: one line per row`)
    }
    const joined = [...left.frames, ...right.frames].join('')
    assert.ok(joined.includes('o'), 'the dishes (the program draws "o") are on screen')
    assert.ok(joined.includes('\x1b[1m'), 'and so are the (bold) cookies')

    // a key press on one window stops everything
    left.socket.write(encode({ t: MSG.QUIT }))
    const { code } = await Promise.race([exited, sleep(5000).then(() => ({ code: 'timeout' }))])
    assert.equal(code, 0, `the scene exits cleanly (stderr: ${stderr})`)
    await sleep(100)
    assert.equal(right.stopped, true, 'the other window was told to stop')
  } finally {
    scene.kill('SIGKILL')
  }
})

test('the scene process exits by itself when the last window goes away', { timeout: 30000 }, async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'slime-e2e-'))
  const scene = spawn(process.execPath, [join(ROOT, 'bin', 'slime-saver-scene'), join(ROOT, 'test', 'fixtures', 'disc.js'), '--expect', '1'], {
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir, SLIME_SAVER_WORKERS: '1', SLIME_SAVER_CONFIG: '/nonexistent.json' },
    stdio: 'ignore',
  })
  const exited = new Promise(resolve => scene.on('exit', (code) => resolve(code)))
  try {
    const client = await connectWhenReady(join(runtimeDir, 'slime-saver.sock'), { x: 0, name: 'ONLY', cols: 60, rows: 30 })
    await sleep(800)
    assert.ok(client.frames.length > 5)
    client.socket.end()
    const code = await Promise.race([exited, sleep(5000).then(() => 'timeout')])
    assert.equal(code, 0)
  } finally {
    scene.kill('SIGKILL')
  }
})

test('the scene process tells you how to use it when started without a program', { timeout: 10000 }, async () => {
  const scene = spawn(process.execPath, [join(ROOT, 'bin', 'slime-saver-scene')], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  scene.stderr.on('data', d => { stderr += d })
  const code = await new Promise(resolve => scene.on('exit', resolve))
  assert.notEqual(code, 0)
  assert.match(stderr, /usage: slime-saver-scene/)
})
