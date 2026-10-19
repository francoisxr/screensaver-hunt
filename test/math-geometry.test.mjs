import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clamp, clamp01, lerp, smootherstep, sum } from '../src/core/math.mjs'
import { lensOverPi, solveDrawnMass, unionMass } from '../src/core/geometry.mjs'

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`)

test('clamp, clamp01, lerp and sum', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-1, 0, 3), 0)
  assert.equal(clamp01(0.4), 0.4)
  assert.equal(clamp01(7), 1)
  assert.equal(lerp(10, 20, 0.25), 12.5)
  assert.equal(sum([1, 2, 3.5]), 6.5)
})

test('smootherstep runs from 0 to 1 with zero slope at both ends and is monotonic', () => {
  assert.equal(smootherstep(-1), 0)
  assert.equal(smootherstep(0), 0)
  assert.equal(smootherstep(1), 1)
  assert.equal(smootherstep(2), 1)
  close(smootherstep(0.5), 0.5)
  let previous = 0
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const v = smootherstep(p)
    assert.ok(v >= previous - 1e-12)
    previous = v
  }
  assert.ok(smootherstep(0.001) < 1e-6) // flat at the start
})

test('lensOverPi: no overlap, full containment and a known overlap', () => {
  assert.equal(lensOverPi(1, 1, 2), 0)
  assert.equal(lensOverPi(1, 1, 5), 0)
  close(lensOverPi(2, 1, 0.5), 1) // the small circle is inside the big one: area pi * 1^2, divided by pi
  // Two unit circles one radius apart overlap in 2*pi/3 - sqrt(3)/2, a known value.
  close(lensOverPi(1, 1, 1), (2 * Math.PI / 3 - Math.sqrt(3) / 2) / Math.PI, 1e-9)
})

test('solveDrawnMass: the two circles cover exactly the target area', () => {
  const r0 = 10
  for (const [target, other, dist] of [[2, 1, 25], [1.5, 0.5, 6], [1.2, 0.8, 0], [3, 1, 12]]) {
    const k = solveDrawnMass(target, other, dist, r0)
    const union = k + other - lensOverPi(Math.sqrt(k), Math.sqrt(other), dist / r0)
    close(union, target, 1e-6)
  }
})

test('solveDrawnMass: when the second hunter has shrunk to nothing the first is the target', () => {
  close(solveDrawnMass(1.7, 0, 0, 10), 1.7, 1e-6)
})

test('unionMass matches the exact area of one circle and of two overlapping ones', () => {
  const r0 = 10
  assert.ok(Math.abs(unionMass([{ x: 0, y: 0, r: r0 }], r0) - 1) < 0.02)
  const two = unionMass([{ x: 0, y: 0, r: r0 }, { x: r0, y: 0, r: r0 }], r0)
  assert.ok(Math.abs(two - (2 - lensOverPi(1, 1, 1))) < 0.03)
  assert.ok(Math.abs(unionMass([{ x: 0, y: 0, r: r0 }, { x: 0, y: 0, r: r0 }], r0) - 1) < 0.02) // identical circles
})
