// Loads the configuration: the defaults, then the user's JSON file on top, then a few environment
// variables. Mistakes (unknown settings, wrong types) are reported as warnings and ignored, so a typo
// never stops the screensaver from starting.

import { existsSync, readFileSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, OPEN_SECTIONS } from './defaults.mjs'

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Where the user's configuration file is looked for. */
export function configPath (env = process.env) {
  if (env.SLIME_SAVER_CONFIG) return env.SLIME_SAVER_CONFIG
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'slime-saver', 'config.json')
}

/**
 * Merges `user` into `target` (in place), checking each setting against the default's type.
 * @param {object} target the defaults (a copy)
 * @param {object} user what the user wrote
 * @param {string[]} warnings collects problems
 * @param {string} path dotted path so far, for messages
 */
export function mergeConfig (target, user, warnings, path = '') {
  for (const [key, value] of Object.entries(user)) {
    const here = path ? `${path}.${key}` : key
    const open = OPEN_SECTIONS.includes(path)
    if (!(key in target)) {
      if (open) target[key] = value
      else warnings.push(`unknown setting "${here}" (ignored)`)
      continue
    }
    const current = target[key]
    if (isPlainObject(current)) {
      if (isPlainObject(value)) mergeConfig(current, value, warnings, here)
      else warnings.push(`"${here}" should be an object (ignored)`)
    } else if (Array.isArray(current)) {
      if (Array.isArray(value) && value.length === current.length && value.every((v, i) => typeof v === typeof current[i])) target[key] = value
      else if (Array.isArray(value) && current.length === 0) target[key] = value
      else warnings.push(`"${here}" should be a list like ${JSON.stringify(current)} (ignored)`)
    } else if (current === null) {
      target[key] = value // e.g. seed: null accepts a number
    } else if (typeof value === typeof current) {
      target[key] = value
    } else {
      warnings.push(`"${here}" should be a ${typeof current} (ignored)`)
    }
  }
  return target
}

/** The few settings that can be given through environment variables. */
function applyEnvironment (config, env) {
  const number = name => (env[name] !== undefined && env[name] !== '' && Number.isFinite(Number(env[name])) ? Number(env[name]) : undefined)
  if (env.SLIME_SAVER_THEME) config.look.cookies.theme = env.SLIME_SAVER_THEME
  if (number('SLIME_SAVER_SPEED') !== undefined) config.runtime.speed = number('SLIME_SAVER_SPEED')
  if (number('SLIME_SAVER_ASPECT') !== undefined) config.runtime.aspect = number('SLIME_SAVER_ASPECT')
  if (number('SLIME_SAVER_SEED') !== undefined) config.runtime.seed = number('SLIME_SAVER_SEED')
  if (number('SLIME_SAVER_WORKERS') !== undefined) config.runtime.workers = number('SLIME_SAVER_WORKERS')
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, path?: string, user?: object }} [options]
 *   `user` lets tests (or callers) pass settings directly instead of reading the file
 * @returns {{ config: typeof DEFAULTS, warnings: string[], path: string }}
 */
export function loadConfig (options = {}) {
  const env = options.env ?? process.env
  const path = options.path ?? configPath(env)
  const warnings = []
  const config = structuredClone(DEFAULTS)

  let user = options.user
  if (user === undefined && existsSync(path)) {
    try {
      user = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      warnings.push(`could not read ${path}: ${e.message}`)
    }
  }
  if (user !== undefined) {
    if (isPlainObject(user)) mergeConfig(config, user, warnings)
    else warnings.push(`${path} should contain a JSON object`)
  }

  applyEnvironment(config, env)
  if (!config.look.cookies.themes[config.look.cookies.theme]) {
    warnings.push(`unknown cookie theme "${config.look.cookies.theme}" (using white)`)
    config.look.cookies.theme = 'white'
  }
  if (!config.runtime.workers) config.runtime.workers = Math.max(1, Math.min(4, cpus().length - 1))
  return { config, warnings, path }
}
