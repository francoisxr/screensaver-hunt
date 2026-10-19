// The bodies of the hunters. A play.core dish is always a round picture; a hunter is drawn as a body
// of any shape with that picture shown inside it.
//
// Each hunter has a body of its own, picked from its id: a skeleton (a U, an S, a K, a starfish...) of
// line segments with a thickness, blended into one smooth organic shape (a union of capsules with
// rounded joins). Bodies are measured in hunter radii and scaled so that every one has the same area
// as a round hunter, so a K is as big as a disc. The skeleton writhes (every joint sways on its own
// slow cycle) and slowly spins; a young hunter grows from a disc into its shape (see `grown`).

import { Rng, mulberry32 } from '../core/rng.mjs'
import { TAU, smootherstep } from '../core/math.mjs'

const BLEND = 0.3 // how softly the limbs merge, in radii
const GRID = 44 // samples per side when measuring a body
const SPAN = 3 // measured over [-SPAN, SPAN] radii

const arc = (from, to, count) => Array.from({ length: count }, (_, i) => {
  const a = from + (to - from) * i / (count - 1)
  return [Math.sin(a), -Math.cos(a)]
})
const chain = nodes => nodes.slice(1).map((_, i) => [i, i + 1])

/**
 * The skeletons, before being scaled to the right area. Each returns nodes [x, y], widths (the
 * half-thickness at each node) and edges (pairs of node indices).
 */
const SHAPES = {
  blob: () => ({ nodes: [[0, 0]], widths: [1], edges: [[0, 0]] }),
  u: () => { const nodes = arc(-1.75, 1.75, 7); return { nodes, widths: nodes.map((_, i) => (i === 0 || i === 6 ? 0.36 : 0.45)), edges: chain(nodes) } },
  c: () => { const nodes = arc(-2.35, 2.35, 9); return { nodes, widths: nodes.map((_, i) => (i === 0 || i === 8 ? 0.3 : 0.42)), edges: chain(nodes) } },
  s: () => {
    const nodes = Array.from({ length: 9 }, (_, i) => { const t = i / 4 - 1; return [t * 1.3, 0.62 * Math.sin(t * Math.PI)] })
    return { nodes, widths: nodes.map((_, i) => (i === 0 || i === 8 ? 0.3 : 0.42)), edges: chain(nodes) }
  },
  k: () => ({ nodes: [[-0.8, -1.2], [-0.8, 0], [-0.8, 1.2], [0.95, -1.15], [0.95, 1.15]], widths: [0.34, 0.4, 0.34, 0.3, 0.3], edges: [[0, 1], [1, 2], [1, 3], [1, 4]] }),
  y: () => ({ nodes: [[0, 1.2], [0, 0], [-1, -0.95], [1, -0.95]], widths: [0.34, 0.42, 0.3, 0.3], edges: [[0, 1], [1, 2], [1, 3]] }),
  z: () => ({ nodes: [[-1, -1], [1, -1], [-1, 1], [1, 1]], widths: [0.32, 0.36, 0.36, 0.32], edges: chain([0, 1, 2, 3]) }),
  l: () => ({ nodes: [[-0.8, -1.05], [-0.8, 0.9], [1.05, 0.9]], widths: [0.36, 0.46, 0.34], edges: [[0, 1], [1, 2]] }),
  t: () => ({ nodes: [[-0.95, -0.8], [0, -0.8], [0.95, -0.8], [0, 1.0]], widths: [0.3, 0.42, 0.3, 0.32], edges: [[0, 1], [1, 2], [1, 3]] }),
  worm: () => { const nodes = Array.from({ length: 6 }, (_, i) => [(i - 2.5) * 0.62, 0.25 * Math.sin(i * 1.3)]); return { nodes, widths: [0.34, 0.48, 0.52, 0.5, 0.46, 0.3], edges: chain(nodes) } },
  star: () => { const nodes = [[0, 0], ...arc(0, TAU * 0.8, 5).map(([x, y]) => [x * 1.15, y * 1.15])]; return { nodes, widths: [0.5, 0.3, 0.3, 0.3, 0.3, 0.3], edges: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]] } },
}

/** The names of the available shapes. */
export const SHAPE_NAMES = Object.keys(SHAPES)

/** Smooth minimum (polynomial): the nearer of a and b, rounding the crease where they meet. */
const smin = (a, b) => {
  const h = Math.max(BLEND - Math.abs(a - b), 0) / BLEND
  return Math.min(a, b) - h * h * BLEND / 4
}

class Body {
  /**
   * @param {number} id
   * @param {string[]} shapes which shapes to pick from
   * @param {{ sway: number }} look
   * @param {Body | null} parent the body this one starts out as (a split piece starts as its parent), or null for a disc
   */
  constructor (id, shapes, look, parent = null) {
    const rng = new Rng(mulberry32(id * 7919 + 17))
    const skeleton = SHAPES[shapes[Math.floor(rng.float(0, shapes.length))]]()
    const flip = rng.sign()
    // a little variety, then the true size
    let nodes = skeleton.nodes.map(([x, y]) => [x + rng.float(-0.1, 0.1), (y + rng.float(-0.1, 0.1)) * flip])
    let widths = skeleton.widths.map(w => w * rng.float(0.9, 1.1))
    this.edges = skeleton.edges
    this.look = look

    // measure the area and the centre of mass by sampling, then centre the body and scale it to the area of a disc
    const probe = { nodes, widths, edges: this.edges }
    let count = 0; let mx = 0; let my = 0
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = (i + 0.5) / GRID * 2 * SPAN - SPAN
        const y = (j + 0.5) / GRID * 2 * SPAN - SPAN
        if (distance(probe, x, y) <= 0) { count++; mx += x; my += y }
      }
    }
    const area = count * (2 * SPAN / GRID) ** 2
    const scale = Math.sqrt(Math.PI / area)
    mx /= count; my /= count
    nodes = nodes.map(([x, y]) => [(x - mx) * scale, (y - my) * scale])
    widths = widths.map(w => w * scale)

    this.base = nodes
    this.widths = widths
    this.reach = Math.max(...nodes.map(([x, y], i) => Math.hypot(x, y) + widths[i])) + 0.1
    this.current = nodes.map(([x, y]) => [x, y])
    this.angle = rng.float(0, TAU)
    this.spin = rng.float(0.04, 0.12) * rng.sign()
    this.sways = nodes.map(() => ({ wx: rng.float(0.3, 0.9), wy: rng.float(0.3, 0.9), px: rng.float(0, TAU), py: rng.float(0, TAU) }))
    this.born = null
    this.parent = parent
    this.rippleId = parent ? parent.rippleId : id // pieces keep their parent's ripple, so the edge does not change at the split
  }

  /** How far the body reaches from its centre at most, in radii, whatever it is doing. */
  get maxReach () { return Math.max(this.reach, this.parent ? this.parent.maxReach : 1) + this.look.sway + 0.05 }

  /** Moves the skeleton to where it is at time t (seconds). Call before `field`. */
  pose (t) {
    if (this.born === null) this.born = t
    if (this.parent) this.parent.pose(t)
    const a = this.angle + this.spin * t
    const cos = Math.cos(a); const sin = Math.sin(a)
    for (let i = 0; i < this.base.length; i++) {
      const s = this.sways[i]
      const x = this.base[i][0] + this.look.sway * Math.sin(s.wx * t + s.px)
      const y = this.base[i][1] + this.look.sway * Math.sin(s.wy * t + s.py)
      this.current[i][0] = x * cos - y * sin
      this.current[i][1] = x * sin + y * cos
    }
  }

  /**
   * How far a body has grown into its own shape, 0..1, `seconds` after the hunter was first seen. Until
   * then it is a blend between what it started as (a disc, or its parent's body) and its own shape.
   */
  grown (t, seconds) {
    const g = seconds <= 0 ? 1 : smootherstep((t - (this.born ?? t)) / seconds)
    if (g >= 1) this.parent = null // fully its own now: let go of the parent
    return g
  }

  /** The body's reach at time t, in radii, blended the same way as the shape. */
  reachAt (t, seconds) {
    const g = this.grown(t, seconds)
    const from = this.parent ? this.parent.reachAt(t, seconds) : 1
    return from + (this.reach - from) * g
  }

  /** Signed distance to the body at (x, y), in radii: negative inside. Includes the blend with where it started. */
  field (x, y, t = Infinity, seconds = 0) {
    const g = this.grown(t, seconds)
    const own = g > 0.001 || !this.parent ? distance({ nodes: this.current, widths: this.widths, edges: this.edges }, x, y) : 0
    if (g >= 1) return own
    const from = this.parent ? this.parent.field(x, y, t, seconds) : Math.hypot(x, y) - 1
    return g > 0.001 ? from + (own - from) * g : from
  }
}

/** Distance from (x, y) to the union of capsules (smoothly blended), negative inside. */
function distance ({ nodes, widths, edges }, x, y) {
  let d = Infinity
  for (let e = 0; e < edges.length; e++) {
    const a = nodes[edges[e][0]]; const b = nodes[edges[e][1]]
    const abx = b[0] - a[0]; const aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby
    const h = len2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * abx + (y - a[1]) * aby) / len2)) : 0
    const w = widths[edges[e][0]] + (widths[edges[e][1]] - widths[edges[e][0]]) * h
    const c = Math.hypot(x - a[0] - abx * h, y - a[1] - aby * h) - w
    d = d === Infinity ? c : smin(d, c)
  }
  return d
}

const bodies = new Map()

/**
 * The body of hunter `id` (made on first use, the same every time). A split piece starts out as its
 * parent's body (`bornFrom`, if that hunter has one) and grows into its own.
 * @param {number} id
 * @param {{ shapes: string[], sway: number }} look the settings of `look.body`
 * @param {number} [bornFrom] id of the hunter this one split from, 0 if none
 * @returns {Body}
 */
export function bodyOf (id, look, bornFrom = 0) {
  let body = bodies.get(id)
  if (!body) {
    const known = look.shapes.filter(name => SHAPES[name])
    body = new Body(id, known.length ? known : SHAPE_NAMES, look, bornFrom ? bodies.get(bornFrom) ?? null : null)
    bodies.set(id, body)
  }
  return body
}

/** Forgets every body (for tests). */
export function forgetBodies () { bodies.clear() }
