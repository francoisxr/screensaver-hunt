// Runs one play.core program fullscreen in the current terminal, like the play.core website does in a
// browser tab. This is the same runtime the screensaver uses for each dish, on its own: handy for
// trying and editing a program (save the file and it reloads).
//
// Exit with q or Ctrl-C (or any key, if asked).

import { watch } from 'node:fs'
import { ENTER_SCREEN, LEAVE_SCREEN, CLEAR, RESET, HOME } from '../core/ansi.mjs'
import { gridToAnsi } from '../core/frame.mjs'
import { describeError } from '../core/runtime.mjs'
import { ProgramHost } from './program-host.mjs'
import { ProgramInstance } from './instance.mjs'

const RELOAD_DEBOUNCE_MS = 100
const CTRL_C = 3

/**
 * @param {object} options
 * @param {string} options.programPath
 * @param {number} [options.aspect] character width / height (default 0.5)
 * @param {boolean} [options.anyKeyExits] any key quits, not just q and Ctrl-C
 * @returns {Promise<void>} resolves never: the process exits when the user quits
 */
export async function runInTerminal ({ programPath, aspect = 0.5, anyKeyExits = false }) {
  const host = new ProgramHost(programPath, { aspect })
  let instance = null
  let timer = null

  const quit = () => {
    clearInterval(timer)
    process.stdout.write(LEAVE_SCREEN)
    process.exit(0)
  }

  async function load () {
    await host.load()
    instance = new ProgramInstance(host, { frame: 0 })
  }

  function frame (time) {
    const { settings } = host
    const cols = settings.cols || process.stdout.columns || 80
    const rows = settings.rows || process.stdout.rows || 24
    if (instance.resize(cols, rows)) process.stdout.write(CLEAR)
    instance.step(time)
    const grid = instance.buffer.map(c => ({ char: c.char, color: c.color, back: c.backgroundColor }))
    process.stdout.write(gridToAnsi(grid, cols, rows, settings))
  }

  process.stdout.write(ENTER_SCREEN)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, quit)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', d => { if (anyKeyExits || d.toString() === 'q' || d[0] === CTRL_C) quit() })
  }

  try {
    await load()
  } catch (e) {
    process.stdout.write(LEAVE_SCREEN)
    console.error(e)
    process.exit(1)
  }

  // Live reload: save the program file and it restarts.
  let reloadTimer
  watch(programPath, () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      try { await load() } catch { /* keep running the previous version */ }
    }, RELOAD_DEBOUNCE_MS)
  })

  const t0 = performance.now()
  timer = setInterval(() => {
    try {
      frame(performance.now() - t0)
    } catch (e) {
      // A bug in the program being edited: show it and wait for the next save.
      process.stdout.write(RESET + HOME + describeError(e).slice(0, 600).replace(/\n/g, '\r\n'))
    }
  }, 1000 / host.settings.fps)
  if (host.settings.once) setTimeout(quit, 100)
}
