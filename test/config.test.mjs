import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, mergeConfig, configPath } from '../src/config/index.mjs'
import { DEFAULTS } from '../src/config/defaults.mjs'

const load = (user, env = {}) => loadConfig({ user, env, path: '/nonexistent.json' })

test('with no user settings the config is the defaults (plus the worker count)', () => {
  const { config, warnings } = load(undefined)
  assert.deepEqual(warnings, [])
  assert.equal(config.physics.hunting.accel, DEFAULTS.physics.hunting.accel)
  assert.ok(config.runtime.workers >= 1)
  assert.equal(DEFAULTS.runtime.workers, 0) // the defaults themselves are not modified
})

test('nested user settings override just what they name', () => {
  const { config, warnings } = load({ physics: { hunting: { accel: 10 } }, look: { cookies: { theme: 'ember' } } })
  assert.deepEqual(warnings, [])
  assert.equal(config.physics.hunting.accel, 10)
  assert.equal(config.physics.hunting.speed, DEFAULTS.physics.hunting.speed)
  assert.equal(config.look.cookies.theme, 'ember')
})

test('unknown settings and wrong types are reported and ignored', () => {
  const { config, warnings } = load({ physics: { hunting: { acell: 5, speed: 'fast' }, bogus: {} }, nonsense: 1 })
  assert.equal(config.physics.hunting.speed, DEFAULTS.physics.hunting.speed)
  assert.equal(warnings.length, 4)
  assert.ok(warnings.some(w => w.includes('physics.hunting.acell')))
  assert.ok(warnings.some(w => w.includes('physics.hunting.speed') && w.includes('number')))
  assert.ok(warnings.some(w => w.includes('nonsense')))
})

test('a pair like [7, 10] must stay a pair of numbers', () => {
  const ok = load({ physics: { hunting: { burst: [5, 6] } } })
  assert.deepEqual(ok.config.physics.hunting.burst, [5, 6])
  const bad = load({ physics: { hunting: { burst: [5] } } })
  assert.deepEqual(bad.config.physics.hunting.burst, DEFAULTS.physics.hunting.burst)
  assert.equal(bad.warnings.length, 1)
})

test('cookie themes are an open list: new names are fine', () => {
  const { config, warnings } = load({ look: { cookies: { theme: 'mine', themes: { mine: ['#123456'] } } } })
  assert.deepEqual(warnings, [])
  assert.equal(config.look.cookies.theme, 'mine')
})

test('an unknown theme falls back to white with a warning', () => {
  const { config, warnings } = load({ look: { cookies: { theme: 'nope' } } })
  assert.equal(config.look.cookies.theme, 'white')
  assert.ok(warnings.some(w => w.includes('nope')))
})

test('the seed can be set (it starts as null)', () => {
  assert.equal(load({}).config.runtime.seed, null)
  assert.equal(load({ runtime: { seed: 5 } }).config.runtime.seed, 5)
})

test('environment variables override the file', () => {
  const { config } = load({ look: { cookies: { theme: 'ember' } } }, { SLIME_SAVER_THEME: 'ice', SLIME_SAVER_SPEED: '4', SLIME_SAVER_SEED: '12', SLIME_SAVER_WORKERS: '2' })
  assert.equal(config.look.cookies.theme, 'ice')
  assert.equal(config.runtime.speed, 4)
  assert.equal(config.runtime.seed, 12)
  assert.equal(config.runtime.workers, 2)
})

test('the config file is read from disk, and a broken one only produces a warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slime-config-'))
  const good = join(dir, 'good.json')
  writeFileSync(good, JSON.stringify({ physics: { hunters: { count: 3 } } }))
  assert.equal(loadConfig({ env: {}, path: good }).config.physics.hunters.count, 3)
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{ not json')
  const result = loadConfig({ env: {}, path: bad })
  assert.equal(result.config.physics.hunters.count, DEFAULTS.physics.hunters.count)
  assert.ok(result.warnings[0].includes('could not read'))
})

test('configPath honours SLIME_SAVER_CONFIG and XDG_CONFIG_HOME', () => {
  assert.equal(configPath({ SLIME_SAVER_CONFIG: '/x/y.json' }), '/x/y.json')
  assert.equal(configPath({ XDG_CONFIG_HOME: '/cfg' }), '/cfg/slime-saver/config.json')
})

test('mergeConfig reports the dotted path of a problem', () => {
  const warnings = []
  mergeConfig(structuredClone(DEFAULTS), { look: { wobble: { base: 'x' } } }, warnings)
  assert.ok(warnings[0].startsWith('"look.wobble.base"'))
})

test('the configuration guide mentions every section of the settings and every built-in theme', async () => {
  const { readFileSync } = await import('node:fs')
  const guide = readFileSync(new URL('../docs/configuration.md', import.meta.url), 'utf8')
  for (const section of Object.keys(DEFAULTS)) assert.ok(guide.includes('`' + section + '`') || guide.includes('### `' + section + '`'), `docs/configuration.md does not mention "${section}"`)
  for (const group of Object.keys(DEFAULTS.physics)) assert.ok(guide.includes('`' + group + '`'), `docs/configuration.md does not mention physics.${group}`)
  for (const theme of Object.keys(DEFAULTS.look.cookies.themes)) assert.ok(guide.includes(theme), `docs/configuration.md does not mention the "${theme}" theme`)
})
