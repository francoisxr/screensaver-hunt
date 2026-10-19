// Shared test helpers.
import { World } from '../src/physics/world.mjs'
import { screenCorners } from '../src/physics/layout.mjs'
import { createRng } from '../src/core/rng.mjs'
import { mergeConfig } from '../src/config/index.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'

export const ASPECT = 0.46
export const ROWS = 45
export const SCREENS = [{ cols: 174 }, { cols: 174 }, { cols: 174 }]
export const AREA_W = 522 * ASPECT
export const R0 = 0.455 * Math.round(DEFAULTS.look.baseSize * ROWS)

/** The default physics settings with `patch` (nested, like the user's config file) on top. */
export function physicsConfig (patch = {}) {
  const config = structuredClone(DEFAULTS.physics)
  config.wrap = false // most tests are about walls; the wrapping world has its own tests
  const warnings = []
  mergeConfig(config, patch, warnings)
  if (warnings.length) throw new Error('bad test settings: ' + warnings.join('; '))
  return config
}

/** A world over three screens, with a seeded random generator. */
export function makeWorld (patch = {}, seed = 1) {
  const world = new World(physicsConfig(patch), { rng: createRng(seed) })
  world.setSpace(AREA_W, ROWS, R0, screenCorners(SCREENS, ASPECT, ROWS))
  return world
}

/** Runs the world for `seconds` at 30 steps per second. `each(world, step)` is called after every step. */
export function run (world, seconds, each) {
  const dt = 1 / 30
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    world.step(dt)
    if (each) each(world, i)
  }
}

/** A world with no random hunters and no cookies, for scripted scenes. */
export function emptyWorld (patch = {}, seed = 1) {
  const base = { hunters: { count: 0 }, cookies: { max: 0 }, kicks: { every: [1e9, 1e9] } }
  const config = physicsConfig(base)
  mergeConfig(config, patch, [])
  const world = new World(config, { rng: createRng(seed) })
  world.setSpace(AREA_W, ROWS, R0, screenCorners(SCREENS, ASPECT, ROWS))
  return world
}
