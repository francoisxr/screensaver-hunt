// Ties each hunter to its dish: the running copy of the program that draws it, on one of the worker
// threads. Keeps one dish per hunter (a new hunter gets a new dish, a merged-away hunter loses its),
// eases each dish's window size toward its hunter's drawn size, hands the workers their jobs, and
// remembers each dish's latest picture.
//
// A split piece starts as an exact copy of the hunter it came from: its dish lives on the same
// worker, starts as a copy of the parent's simulation, and shows the parent's current picture until
// its own first frame arrives. That is what makes a split look like the same texture dividing.

const MIN_WINDOW_ROWS = 6 // a dish window is never smaller than this
const SIZE_EASE = 0.3     // how fast a dish's window follows its hunter's drawn size, per frame

export class DishRegistry {
  /**
   * @param {object} options
   * @param {import('./worker-pool.mjs').WorkerPool} options.pool
   * @param {number} options.pad a dish is drawn in a window this much bigger than the dish itself
   */
  constructor ({ pool, pad }) {
    this.pool = pool
    this.pad = pad
    /** @type {Map<number, { id: number, worker: number, size: number, latest: object | null }>} */
    this.dishes = new Map()
    this.nextWorker = 0
  }

  /** The latest picture of a hunter's dish, or undefined. */
  frame (id) {
    return this.dishes.get(id)?.latest ?? undefined
  }

  /** The pictures a worker finished. */
  receive (results) {
    for (const r of results) {
      const dish = this.dishes.get(r.id)
      if (dish) dish.latest = r
    }
  }

  /**
   * Brings the dishes in line with the hunters and eases their window sizes.
   * @param {import('../physics/hunter.mjs').Hunter[]} hunters
   * @param {number} baseRows window height of a mass-1 hunter, in rows
   */
  sync (hunters, baseRows) {
    const alive = new Set(hunters.map(s => s.id))
    const dropped = []
    for (const id of this.dishes.keys()) {
      if (!alive.has(id)) { dropped.push(id); this.dishes.delete(id) }
    }
    if (dropped.length) this.pool.drop(dropped)

    for (const hunter of hunters) {
      const target = baseRows * Math.sqrt(Math.max(0, hunter.drawMass)) * this.pad
      let dish = this.dishes.get(hunter.id)
      if (!dish) dish = this.create(hunter, target)
      dish.size += SIZE_EASE * (target - dish.size)
    }
  }

  create (hunter, size) {
    const dish = { id: hunter.id, worker: this.nextWorker++ % this.pool.size, size, latest: null }
    const parent = hunter.bornFrom ? this.dishes.get(hunter.bornFrom) : null
    if (parent) {
      dish.worker = parent.worker
      dish.size = parent.size
      dish.latest = parent.latest
      this.pool.clone(dish.worker, hunter.bornFrom, hunter.id)
    }
    this.dishes.set(hunter.id, dish)
    return dish
  }

  /**
   * Hands every idle worker the newest sizes of its dishes.
   * @param {number} time scene time, ms (what programs see as context.time)
   * @param {number} aspect character width / height
   */
  dispatch (time, aspect) {
    for (let w = 0; w < this.pool.size; w++) {
      if (!this.pool.canStep(w)) continue
      const jobs = []
      for (const dish of this.dishes.values()) {
        if (dish.worker !== w) continue
        const rows = Math.max(MIN_WINDOW_ROWS, Math.round(dish.size))
        jobs.push({ id: dish.id, cols: Math.round(rows / aspect), rows, time })
      }
      if (jobs.length > 0) this.pool.step(w, jobs, aspect)
    }
  }
}
