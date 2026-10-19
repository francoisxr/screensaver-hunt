// Terminal control sequences (ANSI / xterm). Colours are 24-bit.

import { parseColor } from './color.mjs'

export const HOME = '\x1b[H' // cursor to the top left
export const CLEAR = '\x1b[2J'
export const RESET = '\x1b[0m'
export const BOLD_ON = '\x1b[1m'
export const BOLD_OFF = '\x1b[22m'
const DEFAULT_FG = '\x1b[39m'
const DEFAULT_BG = '\x1b[49m'

/** Foreground colour from [r, g, b]. */
export const fgRgb = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`

/** Background colour from [r, g, b]. */
export const bgRgb = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`

/** Foreground colour from a CSS colour; the terminal's default if it cannot be parsed. */
export function fgCss (css) {
  const rgb = parseColor(css)
  return rgb ? fgRgb(rgb) : DEFAULT_FG
}

/** Background colour from a CSS colour; the terminal's default if it cannot be parsed. */
export function bgCss (css) {
  const rgb = parseColor(css)
  return rgb ? bgRgb(rgb) : DEFAULT_BG
}

/** Switches to the alternate screen, hides the cursor and paints the background black. */
export const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l\x1b[2J\x1b[0m\x1b]11;rgb:00/00/00\x07'

/** Undoes ENTER_SCREEN: resets colours, shows the cursor, back to the normal screen. */
export const LEAVE_SCREEN = '\x1b[0m\x1b[?25h\x1b[?1049l'
