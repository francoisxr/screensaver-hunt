// Random numbers. Everything in the simulation draws from an `Rng` that is passed in, never from
// Math.random directly, so a run can be repeated exactly by giving it a seed.

/**
 * A small, fast, seedable generator (mulberry32). Returns a function that gives numbers in [0, 1).
 * @param {number} seed any integer
 * @returns {() => number}
 */
export function mulberry32 (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  /** @param {() => number} [random] a function returning numbers in [0, 1) (default Math.random) */
  constructor (random = Math.random) {
    this.random = random
  }

  /** A number in [a, b). */
  float (a, b) { return a + this.random() * (b - a) }

  /** A number in [min, max) from a `[min, max]` pair, as stored in the configuration. */
  range ([a, b]) { return this.float(a, b) }

  /** True with probability p. */
  chance (p) { return this.random() < p }

  /** -1 or +1. */
  sign () { return this.random() < 0.5 ? -1 : 1 }

  /** An integer in [0, n). */
  int (n) { return Math.floor(this.random() * n) }

  /** A random element of an array. */
  pick (array) { return array[this.int(array.length)] }

  /** A normally distributed number (mean 0, standard deviation 1), by the Box-Muller method. */
  gauss () {
    let u = 0
    while (u === 0) u = this.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random())
  }

  /** Shuffles an array in place (Fisher-Yates) and returns it. */
  shuffle (array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
    return array
  }
}

/**
 * @param {number | null | undefined} seed a number for a repeatable sequence; nothing for real randomness
 */
export function createRng (seed) {
  return new Rng(seed === undefined || seed === null ? Math.random : mulberry32(Number(seed)))
}
