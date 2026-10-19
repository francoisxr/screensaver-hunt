// Putting the monitors side by side. Every connected window reports its size in cells and where its
// monitor is; the scene lays them out left to right as one wide area.

/**
 * @typedef {object} Screen
 * @property {number} x       the monitor's position (only the order matters)
 * @property {string} name
 * @property {number} cols    size of its window in cells
 * @property {number} rows
 * @property {number} aspect  measured character width / height, or 0 if not measured yet
 * @property {number} [col0]  set by arrangeScreens: where it starts in the combined area
 */

/**
 * @param {Screen[]} screens everything that has connected
 * @returns {{ screens: Screen[], totalCols: number, rows: number }}
 *   the screens that have reported a size, left to right with `col0` filled in; the combined width;
 *   and the height used for the area (the smallest, so nothing is taller than the shortest screen)
 */
export function arrangeScreens (screens) {
  const ready = screens.filter(s => s.cols > 0 && s.rows > 0).sort((a, b) => a.x - b.x)
  let col = 0
  for (const s of ready) {
    s.col0 = col
    col += s.cols
  }
  return { screens: ready, totalCols: col, rows: ready.length ? Math.min(...ready.map(s => s.rows)) : 0 }
}

/**
 * The character cell shape: the average of what the windows measured, to three decimals, or the
 * configured default if none has measured yet.
 */
export function measuredAspect (screens, fallback) {
  const measured = screens.map(s => s.aspect).filter(Boolean)
  return measured.length ? Math.round(1000 * measured.reduce((a, b) => a + b) / measured.length) / 1000 : fallback
}
