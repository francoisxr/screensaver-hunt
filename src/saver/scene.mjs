// The scene: one tick of the screensaver. It owns the world (the simulation), asks the dish registry to
// keep one running play.core program per hunter, animates the cookies, and composes each screen's slice
// into a frame. It knows nothing about sockets or threads (those are the ScreenHub and the
// WorkerPool, wired up in scene-main.mjs), which keeps it testable.

import { World } from '../physics/world.mjs'
import { screenCorners, screenCentres } from '../physics/layout.mjs'
import { createRng } from '../core/rng.mjs'
import { gridToAnsi } from '../core/frame.mjs'
import { BINS } from '../render/wobble.mjs'
import { dishRadius } from '../render/dish.mjs'
import { composeScreen } from '../render/compositor.mjs'
import { CookieAnimator } from '../render/cookie-animator.mjs'
import { createCookieStyle } from '../render/cookie-style.mjs'
import { Background } from '../render/background.mjs'
import { arrangeScreens, measuredAspect } from './screens.mjs'

const MIN_BASE_ROWS = 8 // a base hunter's window is never shorter than this

export class Scene {
  /**
   * @param {object} options
   * @param {typeof import('../config/defaults.mjs').DEFAULTS} options.config
   * @param {import('./dish-registry.mjs').DishRegistry} options.dishes
   * @param {() => { color: string, backgroundColor: string }} options.programSettings
   *   the colours the program uses for empty cells
   * @param {(message: string) => void} [options.log]
   */
  constructor ({ config, dishes, programSettings, log = () => {} }) {
    this.config = config
    this.dishes = dishes
    this.programSettings = programSettings
    this.log = log

    const seed = config.runtime.seed
    this.world = new World(config.physics, { rng: createRng(seed) })
    this.world.onEvent = e => { if (e.type !== 'eat') log('event ' + JSON.stringify(e)); this.stirBackground(e) }
    this.viewRng = createRng(seed === null ? null : seed + 1) // for the cosmetic randomness (frayed edges, shivers)
    this.animator = new CookieAnimator(config.look.cookies, this.viewRng)
    this.cookieStyle = createCookieStyle(config.look.cookies)
    this.background = config.look.background.enabled ? new Background(config.look.background, this.viewRng) : null

    this.aspect = config.runtime.aspect
    this.firstSeenAt = null   // when the first window reported a size
    this.settled = false      // whether the layout is final: until then there are no hunters, only the background
    this.introAt = null       // when the starting hunters began to fade in
    this.introIds = null
    this.baseRows = MIN_BASE_ROWS
    this.layoutKey = ''
    this.scratch = new Float32Array(BINS)
    this.splitSteps = new WeakMap() // split animation -> how many rings of flies it has sent so far
    this.neckCells = 0 // how many neck cells have been drawn so far (for the debug log)
  }

  /**
   * Advances the simulation and draws every screen.
   * @param {number} timeMs milliseconds since the scene started
   * @param {number} dt seconds since the last tick
   * @param {import('./screens.mjs').Screen[]} allScreens every connected window
   * @returns {{ screen: import('./screens.mjs').Screen, frame: string }[]} one frame per screen that has reported a size
   */
  tick (timeMs, dt, allScreens) {
    const { runtime, look } = this.config
    const { world } = this
    const { screens, totalCols, rows } = arrangeScreens(allScreens)
    if (screens.length === 0) return []

    this.aspect = measuredAspect(screens, runtime.aspect)
    if (this.background) { this.background.resize(totalCols, rows); this.background.update(dt) }
    if (!this.layoutIsFinal(screens, timeMs)) return screens.map(screen => ({ screen, frame: this.drawScreen(screen, timeMs / 1000) }))

    this.updateSpace(screens, totalCols, rows)
    this.fadeInStarters(timeMs)
    world.step(dt * runtime.speed)
    this.animator.update(world.cookies, world.bodies(), s => world.radius(s), dt, timeMs, look.cookies.shape, (a, b) => world.distance(a, b))

    this.stirSplits()
    this.dishes.sync(world.hunters, this.baseRows)
    this.dishes.dispatch(timeMs, this.aspect)

    return screens.map(screen => ({ screen, frame: this.drawScreen(screen, timeMs / 1000) }))
  }

  /**
   * Whether the windows have settled: each has reported a size and measured its character shape (they do
   * that a moment after starting; before then the size can be a transitional one and the shape a guess).
   * Placing the hunters earlier would mean moving them when the truth arrives. After `settleMs` we go on
   * anyway (a desktop where the shape cannot be measured).
   */
  layoutIsFinal (screens, timeMs) {
    if (this.settled) return true
    this.firstSeenAt ??= timeMs
    if (screens.every(s => s.aspect > 0) || timeMs - this.firstSeenAt >= this.config.runtime.settleMs) {
      this.settled = true
      this.log(`layout settled after ${(timeMs - this.firstSeenAt).toFixed(0)} ms`)
    }
    return this.settled
  }

  /** The hunters that were there from the start fade in, instead of popping up. */
  fadeInStarters (timeMs) {
    const { introMs } = this.config.runtime
    if (this.introAt === null) {
      this.introAt = timeMs
      this.introIds = new Set(this.world.hunters.map(s => s.id))
    }
    if (!this.introIds) return
    const k = introMs > 0 ? Math.min(1, (timeMs - this.introAt) / introMs) : 1
    for (const s of this.world.hunters) if (this.introIds.has(s.id) && !s.anim && !s.entering && !s.leaving) s.alpha = k * k * (3 - 2 * k)
    if (k >= 1) this.introIds = null
  }

  /** Tells the world about the area when the windows or their shape changed. */
  updateSpace (screens, totalCols, rows) {
    const { look } = this.config
    this.baseRows = Math.max(MIN_BASE_ROWS, Math.round(look.baseSize * rows))
    const r0 = dishRadius(this.baseRows)
    const areaW = totalCols * this.aspect
    const key = [this.baseRows, totalCols, this.aspect, screens.map(s => s.cols).join('.')].join('|')
    if (key === this.layoutKey) return
    this.layoutKey = key
    this.totalCols = totalCols
    this.rows = rows
    this.world.setSpace(areaW, rows, r0, screenCorners(screens, this.aspect, rows), screenCentres(screens, this.aspect, rows))
    this.log(`layout ${key} area ${areaW.toFixed(0)}x${rows} r0=${r0.toFixed(1)}`)
  }

  /** Merges and splits stir the flies of the background where they happen. */
  stirBackground (event) {
    if (!this.background) return
    const { world } = this
    if (event.type === 'split-done') { // the pop: a wide ring of flies flung out from where the pieces part
      const { pop } = this.config.look.background.life.splitRings
      const piece = world.hunters.find(s => s.id === event.parent)
      if (!piece) return
      const reach = world.radius(piece) * pop.reach
      this.background.stirRing((event.x ?? piece.x) / this.aspect, event.y ?? piece.y, Math.max(0, reach - pop.width), reach, pop.density, this.aspect)
      return
    }
    if (event.type !== 'merge' && event.type !== 'split') return
    const hunter = world.hunters.find(s => s.id === (event.keep ?? event.parent))
    if (!hunter) return
    const { life } = this.config.look.background
    const burst = event.type === 'merge' ? life.mergeBurst : life.splitBurst
    this.background.stir(hunter.x / this.aspect, hunter.y, world.radius(hunter) * burst.radius, burst.density, this.aspect)
  }

  /** While a hunter splits, rings of flies spread out from it, keeping pace with the pieces parting. */
  stirSplits () {
    if (!this.background) return
    const { world } = this
    const { steps, width, density } = this.config.look.background.life.splitRings
    for (const s of world.hunters) {
      const a = s.anim
      if (!a || a.type !== 'split' || a.parent !== s) continue
      const done = this.splitSteps.get(a) ?? 0
      const due = Math.min(steps, Math.floor(a.p * steps) + 1)
      if (due <= done) continue
      this.splitSteps.set(a, due)
      const reach = world.radius(s) * (0.7 + 1.8 * a.e)
      this.background.stirRing(s.x / this.aspect, s.y, Math.max(0, reach - width), reach, density, this.aspect)
    }
  }

  drawScreen (screen, seconds) {
    const { world } = this
    const { grid, neckCells } = composeScreen({
      screen,
      hunters: world.hunters,
      links: world.links,
      cookies: world.cookies,
      dishFrame: id => this.dishes.frame(id),
      cookieView: id => this.animator.view(id),
      cookieShade: this.cookieStyle,
      aspect: this.aspect,
      seconds,
      look: this.config.look,
      r0: world.r0,
      wrap: world.cfg.wrap ? { cols: this.totalCols, rows: this.rows } : null,
      background: this.background,
      rng: this.viewRng,
      scratch: this.scratch,
    })
    this.neckCells += neckCells
    return gridToAnsi(grid, screen.cols, screen.rows, this.programSettings())
  }

  /** A one-line summary for the debug log. */
  describe () {
    const { world, animator } = this
    const fears = world.cookies.map(c => animator.view(c.id).fear)
    return [
      `hunters=${world.hunters.length}`,
      `cookies=${world.cookies.length}`,
      `hunting=${world.hunters.filter(s => s.prey).length}`,
      `fear=${fears.length ? Math.max(...fears).toFixed(2) : '-'}`,
      `shaking=${world.cookies.filter(c => animator.view(c.id).jx || animator.view(c.id).jy).length}`,
      `necks=${this.neckCells}`,
      `masses=${world.hunters.map(s => s.mass.toFixed(2) + (s.sickUntil ? '!' : '')).join(',')}`,
    ].join(' ')
  }
}
