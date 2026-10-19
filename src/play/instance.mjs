// One running copy of a play.core program: its own data, its own buffer of cells, its own size.
//
// This mirrors what play.core's runner does each frame: normalise the buffer when the size changes,
// call `pre`, call `main` for every cell (storing what it returns), call `post`. The program itself
// is never modified, and many instances of one program can run side by side (that is how the
// screensaver gets nine dishes from one slime_dish.js).

import { deepClone } from './clone.mjs'

const EMPTY_CELL = ' '
/** There is no pointer in a terminal screensaver. */
const IDLE_CURSOR = { x: 0, y: 0, pressed: false, p: { x: 0, y: 0, pressed: false } }

export class ProgramInstance {
  /**
   * @param {import('./program-host.mjs').ProgramHost} host
   * @param {{ frame?: number, random?: () => number }} [options]
   *   `frame` is the frame counter to start from; by default a random one, so that copies of a program
   *   that animate with the frame number are out of step with each other.
   */
  constructor (host, { frame, random = Math.random } = {}) {
    this.host = host
    this.data = {}      // what the program keeps between frames
    this.buffer = []    // cells: { char, color, backgroundColor, fontWeight }
    this.cols = 0
    this.rows = 0
    this.frame = frame ?? Math.floor(random() * 1000)
    this.time = 0
    this.booted = false
  }

  /** The `context` argument programs receive. */
  context () {
    const { settings, metrics } = this.host
    return Object.freeze({
      frame: this.frame,
      time: this.time,
      cols: this.cols,
      rows: this.rows,
      metrics,
      width: this.cols * metrics.cellWidth,
      height: this.rows * metrics.lineHeight,
      settings,
      runtime: Object.freeze({ cycle: 0, fps: settings.fps }),
    })
  }

  /** Sets the size in cells. Returns true when it changed (the buffer was rebuilt). */
  resize (cols, rows) {
    if (cols === this.cols && rows === this.rows) return false
    const { settings } = this.host
    this.cols = cols
    this.rows = rows
    this.buffer.length = cols * rows
    for (let i = 0; i < this.buffer.length; i++) {
      this.buffer[i] = { color: settings.color, backgroundColor: settings.backgroundColor, fontWeight: settings.fontWeight, char: EMPTY_CELL }
    }
    return true
  }

  /** Starts the program afresh (calls its `boot`). Does nothing until the size is known. */
  boot () {
    this.data = {}
    this.booted = false
    if (!this.cols) return
    const { module } = this.host
    if (typeof module.boot === 'function') module.boot(this.context(), this.buffer, this.data)
    this.booted = true
  }

  /**
   * Runs one frame.
   * @param {number} time milliseconds, as `context.time`
   */
  step (time) {
    if (!this.booted) this.boot()
    this.time = time
    this.frame++
    const { module } = this.host
    const context = this.context()
    if (typeof module.pre === 'function') module.pre(context, IDLE_CURSOR, this.buffer, this.data)
    if (typeof module.main === 'function') this.runMain(module, context)
    if (typeof module.post === 'function') module.post(context, IDLE_CURSOR, this.buffer, this.data)
  }

  runMain (module, context) {
    for (let j = 0; j < this.rows; j++) {
      const offs = j * this.cols
      for (let i = 0; i < this.cols; i++) {
        const idx = i + offs
        const out = module.main({ x: i, y: j, index: idx }, context, IDLE_CURSOR, this.buffer, this.data)
        if (typeof out === 'object' && out !== null) this.buffer[idx] = { ...this.buffer[idx], ...out }
        else this.buffer[idx] = { ...this.buffer[idx], char: out }
        if (!this.buffer[idx].char && this.buffer[idx].char !== 0) this.buffer[idx].char = EMPTY_CELL
      }
    }
  }

  /**
   * What a renderer needs: the characters, plus the colours only if the program actually used any.
   * @returns {{ cols: number, rows: number, chars: string[], colors?: string[], backs?: string[] }}
   */
  snapshot () {
    const { settings } = this.host
    const n = this.buffer.length
    const chars = new Array(n)
    let coloured = false
    for (let i = 0; i < n; i++) {
      const c = this.buffer[i]
      chars[i] = c.char
      if (c.color !== settings.color || c.backgroundColor !== settings.backgroundColor) coloured = true
    }
    const out = { cols: this.cols, rows: this.rows, chars }
    if (coloured) {
      out.colors = this.buffer.map(c => c.color)
      out.backs = this.buffer.map(c => c.backgroundColor)
    }
    return out
  }

  /** An independent copy that continues from exactly this state (data, buffer, frame). */
  clone () {
    const copy = new ProgramInstance(this.host, { frame: this.frame })
    copy.data = deepClone(this.data)
    copy.buffer = this.buffer.map(cell => ({ ...cell }))
    copy.cols = this.cols
    copy.rows = this.rows
    copy.time = this.time
    copy.booted = this.booted
    return copy
  }
}
