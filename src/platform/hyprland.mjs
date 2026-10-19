// The Hyprland-specific parts: finding out whether our window still has focus (when it does not, the
// user has moved on and the screensaver should stop) and measuring the shape of a character cell from
// the size of our fullscreen window. Everything goes through `hyprctl`.
//
// A "platform" is any object with the two methods below; on other desktops the null platform is used
// and the screensaver simply stops on a key press.

import { execFileSync } from 'node:child_process'

/**
 * @typedef {object} Platform
 * @property {string} name
 * @property {() => boolean | null} hasFocus  whether our window is the focused one; null when unknown
 * @property {(cols: number, rows: number) => number | null} measureAspect
 *   character width / height, from the window's pixel size and its size in cells; null when unknown
 */

function hyprctlActiveWindow () {
  return JSON.parse(execFileSync('hyprctl', ['activewindow', '-j'], { encoding: 'utf8' }))
}

/**
 * @param {{ windowClass: string }} options the app id / class our windows were opened with
 * @returns {Platform}
 */
export function createHyprlandPlatform ({ windowClass }) {
  return {
    name: 'hyprland',

    hasFocus () {
      try { return hyprctlActiveWindow().class === windowClass } catch { return null }
    },

    measureAspect (cols, rows) {
      try {
        const w = hyprctlActiveWindow()
        if (w.class !== windowClass || !w.size || !(w.size[0] > 0) || !(w.size[1] > 0)) return null
        const aspect = (w.size[0] / cols) / (w.size[1] / rows)
        return aspect > 0.2 && aspect < 1 ? aspect : null
      } catch { return null }
    },
  }
}

/** For desktops we know nothing about: never claims anything. @returns {Platform} */
export function createNullPlatform () {
  return { name: 'none', hasFocus: () => null, measureAspect: () => null }
}

/**
 * Picks the platform for the environment we run in.
 * @param {{ windowClass: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Platform}
 */
export function detectPlatform ({ windowClass, env = process.env }) {
  return env.HYPRLAND_INSTANCE_SIGNATURE ? createHyprlandPlatform({ windowClass }) : createNullPlatform()
}
