// Where the running screensaver keeps its socket and log, and the debug logger.
//
// The scene (one process) and the display clients (one per monitor window) find each other through
// a unix socket in the user's runtime directory. Debugging is switched on by SLIME_SAVER_DEBUG=1 or,
// for processes started by the window manager (which do not inherit your shell's environment), by
// creating the flag file `slime-saver.debug` in the runtime directory.

import { appendFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ dir: string, socket: string, log: string, debugFlag: string }}
 */
export function runtimePaths (env = process.env) {
  const dir = env.XDG_RUNTIME_DIR || tmpdir()
  return {
    dir,
    socket: join(dir, 'slime-saver.sock'),
    log: join(dir, 'slime-saver.log'),
    debugFlag: join(dir, 'slime-saver.debug'),
  }
}

/** True when debug logging is on (checked on every call, so the flag file can be created later). */
export function debugEnabled (env = process.env) {
  return Boolean(env.SLIME_SAVER_DEBUG) || existsSync(runtimePaths(env).debugFlag)
}

/**
 * A logger that appends `<prefix><message>` lines to the log file while debugging is on.
 * @param {string} [prefix] e.g. 'client DP-1: '
 * @returns {(message: string) => void}
 */
export function createLogger (prefix = '', env = process.env) {
  return message => {
    if (!debugEnabled(env)) return
    try { appendFileSync(runtimePaths(env).log, prefix + message + '\n') } catch { /* logging must never break the screensaver */ }
  }
}

/** Formats a caught value for a log line. */
export const describeError = e => String((e && e.stack) || e)
