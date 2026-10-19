import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Rng, createRng, mulberry32 } from '../src/core/rng.mjs'

test('the same seed gives the same sequence, a different seed does not', () => {
  const a = createRng(42)
  const b = createRng(42)
  const c = createRng(43)
  const take = r => Array.from({ length: 8 }, () => r.random())
  assert.deepEqual(take(a), take(b))
  assert.notDeepEqual(take(createRng(42)), take(c))
})

test('numbers stay in range', () => {
  const rng = createRng(1)
  for (let i = 0; i < 2000; i++) {
    const x = rng.random()
    assert.ok(x >= 0 && x < 1)
    const f = rng.float(5, 7)
    assert.ok(f >= 5 && f < 7)
    const r = rng.range([-2, -1])
    assert.ok(r >= -2 && r < -1)
    const n = rng.int(4)
    assert.ok(Number.isInteger(n) && n >= 0 && n < 4)
  }
})

test('chance(p) is true about p of the time', () => {
  const rng = createRng(7)
  let hits = 0
  for (let i = 0; i < 20000; i++) if (rng.chance(0.25)) hits++
  assert.ok(Math.abs(hits / 20000 - 0.25) < 0.02)
  assert.equal(createRng(1).chance(0), false)
  assert.equal(createRng(1).chance(1), true)
})

test('sign() gives only -1 and +1', () => {
  const rng = createRng(3)
  const seen = new Set(Array.from({ length: 200 }, () => rng.sign()))
  assert.deepEqual([...seen].sort(), [-1, 1])
})

test('gauss() has mean 0 and standard deviation 1', () => {
  const rng = createRng(11)
  const values = Array.from({ length: 40000 }, () => rng.gauss())
  const mean = values.reduce((a, b) => a + b) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  assert.ok(Math.abs(mean) < 0.03)
  assert.ok(Math.abs(variance - 1) < 0.05)
})

test('shuffle() returns a permutation of the same array', () => {
  const rng = createRng(5)
  const original = [1, 2, 3, 4, 5, 6, 7, 8]
  const shuffled = rng.shuffle([...original])
  assert.deepEqual([...shuffled].sort(), original)
  assert.notDeepEqual(shuffled, original)
})

test('pick() returns an element', () => {
  const rng = createRng(9)
  for (let i = 0; i < 50; i++) assert.ok(['a', 'b', 'c'].includes(rng.pick(['a', 'b', 'c'])))
})

test('without a seed the generator is real randomness, with a custom source it uses it', () => {
  assert.ok(createRng() instanceof Rng)
  assert.equal(new Rng(() => 0.5).float(0, 10), 5)
  assert.equal(typeof mulberry32(1)(), 'number')
})
