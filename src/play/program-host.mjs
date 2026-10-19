// A play.core program, loaded from a file. A program is an ES module that exports some of
// `boot`, `pre`, `main`, `post` and `settings` (see https://play.ertdfgcvb.xyz). The host loads the
// module and holds what every running copy of it shares: its settings and the "metrics" (the shape
// of a character cell), which a browser would measure from the font.

import { pathToFileURL } from 'node:url'

/** The defaults of play.core's own runner (cols / rows 0 mean "the whole terminal"). */
export const DEFAULT_SETTINGS = {
  cols: 0,
  rows: 0,
  once: false,
  fps: 30,
  color: 'white',
  backgroundColor: 'black',
  fontWeight: 'normal',
}

/** The metrics object programs read from `context.metrics`. `aspect` is a cell's width / height. */
export function createMetrics (aspect) {
  return {
    aspect,
    cellWidth: 1,
    lineHeight: 1 / aspect,
    fontFamily: 'monospace',
    fontSize: 1,
    _update () {},
  }
}

export class ProgramHost {
  /**
   * @param {string} path the program file
   * @param {{ aspect?: number }} [options] width / height of a character cell
   */
  constructor (path, { aspect = 0.5 } = {}) {
    this.path = path
    this.metrics = createMetrics(aspect)
    this.module = null
    this.settings = { ...DEFAULT_SETTINGS }
    this.version = 0
  }

  /** (Re)loads the file. A query string defeats the module cache, so edits are picked up. */
  async load () {
    this.module = await import(pathToFileURL(this.path).href + '?v=' + (++this.version))
    this.settings = { ...DEFAULT_SETTINGS, ...this.module.settings }
    return this
  }

  /** Changes the cell shape (a window measured it). */
  setAspect (aspect) {
    if (aspect === this.metrics.aspect) return
    this.metrics.aspect = aspect
    this.metrics.lineHeight = 1 / aspect
  }
}
