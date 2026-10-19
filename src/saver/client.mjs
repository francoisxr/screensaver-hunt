// The display client: one runs in each monitor's terminal window. It connects to the scene, tells it the
// window's size, prints the frames it sends back, and stops everything when you press a key or the
// window loses focus.
//
//   slime-saver-client <monitor-x> <monitor-name> [window-class]

import net from 'node:net'
import { createLogger, describeError, runtimePaths } from '../core/runtime.mjs'
import { ENTER_SCREEN, LEAVE_SCREEN, CLEAR } from '../core/ansi.mjs'
import { detectPlatform } from '../platform/hyprland.mjs'
import { MSG, encode, LineDecoder } from './protocol.mjs'

const CONNECT_RETRIES = 60    // the scene may still be starting...
const CONNECT_RETRY_MS = 100  // ...so try for about six seconds
const ASPECT_DELAY_MS = 1500  // measure the cell shape once the window has settled
const FOCUS_GRACE_MS = 4000   // the launcher is still moving focus around at first
const FOCUS_CHECK_MS = 1000
const FOCUS_MISSES = 2        // lose focus for this many checks in a row and we stop

/**
 * @param {object} options
 * @param {number} options.x           this monitor's position (the scene lays monitors out left to right)
 * @param {string} options.name        the monitor's name
 * @param {string} [options.windowClass] the app id of our window, for the focus check
 * @param {import('../platform/hyprland.mjs').Platform} [options.platform]
 */
export function runClient ({ x, name, windowClass = 'slime-saver', platform = detectPlatform({ windowClass }) }) {
  const { socket: socketPath } = runtimePaths()
  const log = createLogger(`client ${name}: `)
  const startedAt = Date.now()
  let socket = null
  let connected = false

  const size = () => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 })
  const tell = message => { if (socket && !socket.destroyed) try { socket.write(encode(message)) } catch { /* it is going away */ } }

  function quit (tellScene, why = '') {
    log('quit ' + why)
    if (tellScene) tell({ t: MSG.QUIT })
    process.stdout.write(LEAVE_SCREEN)
    process.exit(0)
  }

  process.on('uncaughtException', e => { log('uncaught ' + describeError(e)); process.exit(1) })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, () => quit(true, signal))
  process.stdout.write(ENTER_SCREEN)

  // Any key stops the screensaver.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', data => {
      if (data.length === 0) return // an empty read is not a key
      quit(true, `key ${JSON.stringify(data.toString())} after ${Date.now() - startedAt}ms`)
    })
  }

  function connect (attempt = 0) {
    const decoder = new LineDecoder()
    socket = net.connect(socketPath)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      connected = true
      tell({ t: MSG.HELLO, x, name, ...size() })
    })
    socket.on('data', chunk => {
      for (const m of decoder.push(chunk)) {
        if (m.t === MSG.FRAME) process.stdout.write(m.d)
        else if (m.t === MSG.STOP) quit(false, 'scene said quit')
      }
    })
    socket.on('error', () => {
      if (connected) return quit(false, 'socket error')
      if (attempt < CONNECT_RETRIES) setTimeout(() => connect(attempt + 1), CONNECT_RETRY_MS)
      else quit(false, 'could not connect')
    })
    socket.on('close', () => { if (connected) quit(false, 'socket closed') })
  }
  connect()

  process.stdout.on('resize', () => {
    process.stdout.write(CLEAR)
    tell({ t: MSG.SIZE, ...size() })
  })

  // The shape of a character cell, so the dishes come out round.
  setTimeout(() => {
    const { cols, rows } = size()
    const aspect = platform.measureAspect(cols, rows)
    if (aspect) tell({ t: MSG.ASPECT, v: aspect })
  }, ASPECT_DELAY_MS)

  // Stop when this window loses focus (after a grace period, and only after several misses in a row).
  let misses = 0
  setInterval(() => {
    if (Date.now() - startedAt < FOCUS_GRACE_MS) return
    const focused = platform.hasFocus()
    if (focused === null) return
    if (focused) misses = 0
    else if (++misses >= FOCUS_MISSES) quit(true, 'focus lost')
  }, FOCUS_CHECK_MS)
}
