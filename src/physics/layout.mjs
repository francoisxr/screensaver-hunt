// The shape of the space the hunters live in: all the screens side by side, as one wide area.

/**
 * The distinct corner points of a row of screens laid side by side, in units. Hunters are pushed away
 * from every one of them, including the points where two screens meet.
 * @param {{cols: number}[]} screens left to right
 * @param {number} aspect character width / height
 * @param {number} height rows
 * @returns {[number, number][]}
 */
export function screenCorners (screens, aspect, height) {
  const seen = new Set()
  const out = []
  let col = 0
  for (const s of screens) {
    for (const cx of [col, col + s.cols]) {
      for (const cy of [0, height]) {
        const key = cx + ',' + cy
        if (!seen.has(key)) { seen.add(key); out.push([cx * aspect, cy]) }
      }
    }
    col += s.cols
  }
  return out
}
