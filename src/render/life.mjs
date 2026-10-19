// Conway's Game of Life on a wrapped grid, written for a background that should never go quiet.
// (The rules are the classic ones; the contributed "GOL" program of play.core was the inspiration. That
// program stalls when nothing touches it, so this one watches itself and gives the board a small push.)
//
// Stagnation: every generation the board is hashed. If the hash has been seen within the last
// `history` generations, the board is static or stuck in a short cycle, and a push is added: a few small
// random patches, sometimes a glider that flies off across the board. A push is never a reset, and the
// board gets another one at most every `cooldown` generations. Bursts (`burst`) let the outside world
// stir a place of the board on purpose.
//
// Each cell also has a `trail`: 1 while alive, fading by `fade` per generation after it dies, so moving
// groups leave a short smear, like flies.

const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] // cells of a glider heading down-right

export class Life {
  /**
   * @param {typeof import('../config/defaults.mjs').DEFAULTS.look.background.life} settings
   * @param {import('../core/rng.mjs').Rng} rng
   */
  constructor (settings, rng) {
    this.s = settings
    this.rng = rng
    this.cols = 0
    this.rows = 0
    this.cells = new Uint8Array(0)
    this.next = new Uint8Array(0)
    this.trail = new Float32Array(0)
    this.history = []
    this.sinceLastPush = Infinity
    this.clock = 0
    this.generation = 0
    this.pushes = 0
  }

  /** Starts a fresh board of this size, seeded with a few swarms. */
  resize (cols, rows) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.cells = new Uint8Array(cols * rows)
    this.next = new Uint8Array(cols * rows)
    this.trail = new Float32Array(cols * rows)
    this.history = []
    const swarms = Math.max(3, Math.round(cols * rows * this.s.density / 90))
    for (let i = 0; i < swarms; i++) this.patch(this.rng.float(0, cols), this.rng.float(0, rows), 9, 0.4)
  }

  /** Advances by dt seconds: one generation each `stepSeconds` (never more than a few per call). */
  update (dt) {
    this.clock += dt
    for (let i = 0; i < 3 && this.clock >= this.s.stepSeconds; i++) {
      this.clock -= this.s.stepSeconds
      this.step()
    }
    if (this.clock > this.s.stepSeconds) this.clock = 0 // we were stalled: do not try to catch up
  }

  /** One generation of the game of life, with the board wrapping around at the edges. */
  step () {
    const { cols, rows, cells, next, trail } = this
    for (let y = 0; y < rows; y++) {
      const up = ((y + rows - 1) % rows) * cols
      const here = y * cols
      const down = ((y + 1) % rows) * cols
      for (let x = 0; x < cols; x++) {
        const l = (x + cols - 1) % cols
        const r = (x + 1) % cols
        const n = cells[up + l] + cells[up + x] + cells[up + r] + cells[here + l] + cells[here + r] + cells[down + l] + cells[down + x] + cells[down + r]
        const alive = cells[here + x] ? n === 2 || n === 3 : n === 3
        next[here + x] = alive ? 1 : 0
        trail[here + x] = alive ? 1 : trail[here + x] * this.s.fade
      }
    }
    this.cells = next
    this.next = cells
    this.generation++
    this.sinceLastPush++
    this.watch()
  }

  /** Looks for a board that stopped changing (or cycles quickly) or died out, and pushes it. */
  watch () {
    let hash = 2166136261
    let population = 0
    for (let i = 0; i < this.cells.length; i++) {
      hash = Math.imul(hash ^ this.cells[i], 16777619)
      population += this.cells[i]
    }
    const repeated = this.history.includes(hash)
    this.history.push(hash)
    if (this.history.length > this.s.history) this.history.shift()
    const sparse = population < this.cells.length * this.s.minPopulation
    if ((repeated || sparse) && this.sinceLastPush >= this.s.push.cooldown) this.push()
  }

  /** A small push: a few random patches, and now and then a glider. */
  push () {
    const { push } = this.s
    this.pushes++
    this.sinceLastPush = 0
    this.history = []
    for (let i = 0; i < push.spots; i++) this.patch(this.rng.float(0, this.cols), this.rng.float(0, this.rows), push.size, push.density)
    if (this.rng.chance(push.gliderChance)) this.glider(this.rng.float(0, this.cols), this.rng.float(0, this.rows))
  }

  /** Brings a disc of cells to life at random (a burst): radius in rows, so it is round on screen. */
  burst (col, row, radius, density, aspect) {
    this.patch(col, row, radius, density, aspect)
  }

  /** Brings a ring of cells to life at random: between `inner` and `outer` rows from (col, row). */
  ring (col, row, inner, outer, density, aspect) {
    const reach = Math.ceil(outer / aspect)
    for (let dy = -Math.ceil(outer); dy <= Math.ceil(outer); dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx * aspect, dy)
        if (d < inner || d > outer || !this.rng.chance(density)) continue
        this.set(Math.round(col) + dx, Math.round(row) + dy)
      }
    }
  }

  /** Random live cells inside a disc around (col, row). `size` is the radius in rows. */
  patch (col, row, size, density, aspect = 0.5) {
    const reach = Math.ceil(size / aspect)
    for (let dy = -Math.ceil(size); dy <= Math.ceil(size); dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx * aspect, dy) > size || !this.rng.chance(density)) continue
        this.set(Math.round(col) + dx, Math.round(row) + dy)
      }
    }
  }

  /** A glider, heading off in a random diagonal direction. */
  glider (col, row) {
    const flipX = this.rng.chance(0.5)
    const flipY = this.rng.chance(0.5)
    for (const [gx, gy] of GLIDER) this.set(Math.round(col) + (flipX ? 2 - gx : gx), Math.round(row) + (flipY ? 2 - gy : gy))
  }

  set (col, row) {
    const x = ((col % this.cols) + this.cols) % this.cols
    const y = ((row % this.rows) + this.rows) % this.rows
    this.cells[x + y * this.cols] = 1
    this.trail[x + y * this.cols] = 1
  }

  /** 1 where a cell is alive, fading toward 0 where one has just died. Outside the board: 0. */
  intensity (col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 0
    return this.trail[col + row * this.cols]
  }
}
