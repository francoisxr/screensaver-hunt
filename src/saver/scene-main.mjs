// The scene process: wires the hub (sockets), the worker pool (threads) and the scene together and runs
// the frame loop. Started by the launcher, headless; the display clients connect to it.
//
//   slime-saver-scene <program.js> [--expect N]
//
// It waits for N display windows to say hello (or a few seconds), then runs until a client asks to
// stop, the last window goes away, or it is killed. Saving the program file reloads it live.

import { watch } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from '../config/index.mjs'
import { createLogger, describeError, runtimePaths } from '../core/runtime.mjs'
import { playCoreDir } from '../play/module-hooks.mjs'
import { ScreenHub } from './screen-hub.mjs'
import { WorkerPool } from './worker-pool.mjs'
import { DishRegistry } from './dish-registry.mjs'
import { Scene } from './scene.mjs'

const USAGE = 'usage: slime-saver-scene <program.js> [--expect N]'
const RELOAD_DEBOUNCE_MS = 100
const STOP_GRACE_MS = 200       // clients get this long to leave their screens before we exit
const NO_CLIENT_GRACE_MS = 4000 // after the wait for windows, give up if nobody came
const STATS_EVERY_MS = 5000
const MAX_DT = 0.1              // a long stall (suspend, debugger) never advances the simulation by more than this

function parseArguments (argv) {
  let program = null
  let expect = 1
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expect') expect = Number(argv[++i])
    else if (!argv[i].startsWith('--')) program = argv[i]
  }
  if (!program || !Number.isFinite(expect)) throw new Error(USAGE)
  return { programPath: resolve(program), expect }
}

export async function main (argv = process.argv.slice(2)) {
  const { programPath, expect } = parseArguments(argv)
  const paths = runtimePaths()
  const log = createLogger()
  const { config, warnings, path: configFile } = loadConfig()
  for (const w of warnings) { console.error(`slime-saver: ${configFile}: ${w}`); log(`config warning: ${w}`) }

  const hub = new ScreenHub({ socketPath: paths.socket, log })
  let registry = null
  const pool = new WorkerPool({
    size: config.runtime.workers,
    programPath,
    aspect: config.runtime.aspect,
    playCoreDir: playCoreDir(),
    onResults: results => registry.receive(results),
    log,
  })
  registry = new DishRegistry({ pool, pad: config.look.pad })
  const scene = new Scene({ config, dishes: registry, programSettings: () => pool.settings, log })

  let started = false
  const shutdown = () => { hub.close(); pool.terminate(); process.exit(0) }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown)
  hub.on('quit', () => { hub.stopAll(); setTimeout(shutdown, STOP_GRACE_MS) })
  hub.on('empty', () => { if (started) shutdown() })

  hub.listen()
  const waitStart = performance.now()
  const waiter = setInterval(() => {
    if (hub.readyCount >= expect || performance.now() - waitStart > config.runtime.waitForScreensMs) {
      clearInterval(waiter)
      started = true
      run(config, hub, pool, scene, programPath, log)
    }
  }, 50)
  setTimeout(() => { if (!started && hub.clients.size === 0) shutdown() }, config.runtime.waitForScreensMs + NO_CLIENT_GRACE_MS)
}

/** The frame loop. */
function run (config, hub, pool, scene, programPath, log) {
  let reloadTimer
  watch(programPath, () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => pool.reload(), RELOAD_DEBOUNCE_MS)
  })

  const t0 = performance.now()
  let previous = t0
  let lastStats = 0
  let frames = 0
  setInterval(() => {
    const now = performance.now()
    const dt = Math.min(MAX_DT, (now - previous) / 1000)
    previous = now
    frames++
    try {
      for (const { screen, frame } of scene.tick(now - t0, dt, [...hub.clients])) hub.sendFrame(screen, frame)
    } catch (e) {
      log('tick error: ' + describeError(e))
    }
    if (now - lastStats > STATS_EVERY_MS) {
      log(`t=${((now - t0) / 1000).toFixed(0)}s ${(frames / ((now - lastStats) / 1000)).toFixed(0)}fps ${scene.describe()}`)
      lastStats = now
      frames = 0
    }
  }, 1000 / config.runtime.fps)
}
