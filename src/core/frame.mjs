// Turns a grid of cells into one string of terminal escape codes, changing colour only where it
// changes (runs of the same colour cost nothing).

import { HOME, BOLD_ON, BOLD_OFF, fgRgb, fgCss, bgCss } from './ansi.mjs'

/**
 * @typedef {object} Cell
 * @property {string} char          what to draw
 * @property {string | null} [color]  CSS foreground colour (the default when absent)
 * @property {number[]} [rgb]       foreground as [r, g, b]; takes precedence over `color`
 * @property {string} [back]        CSS background colour (the default when absent)
 * @property {boolean} [bold]
 */

/**
 * @param {(Cell | null)[]} grid cols * rows cells, row by row; null is an empty cell
 * @param {number} cols
 * @param {number} rows
 * @param {{ color: string, backgroundColor: string }} defaults colours of empty cells and of cells that name none
 * @returns {string} the cursor goes home first, rows are joined with CR LF (no newline at the end)
 */
export function gridToAnsi (grid, cols, rows, defaults) {
  let out = HOME
  let curFg = null
  let curBg = null
  let curBold = false
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[x + y * cols]

      const bold = Boolean(cell && cell.bold)
      if (bold !== curBold) { out += bold ? BOLD_ON : BOLD_OFF; curBold = bold }

      const rgb = cell && cell.rgb
      const fg = rgb ? `rgb:${rgb[0]};${rgb[1]};${rgb[2]}` : (cell && cell.color) || defaults.color
      if (fg !== curFg) { out += rgb ? fgRgb(rgb) : fgCss(fg); curFg = fg }

      const bg = (cell && cell.back) || defaults.backgroundColor
      if (bg !== curBg) { out += bgCss(bg); curBg = bg }

      out += cell ? cell.char : ' '
    }
    if (y < rows - 1) out += '\r\n'
  }
  return out
}
