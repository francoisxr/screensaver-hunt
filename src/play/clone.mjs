// A deep copy for a program's own data. structuredClone would strip the prototypes of class
// instances (a program's Agent objects lose their methods), so this one keeps them. Typed arrays,
// Maps, Sets and shared or circular references are handled; functions are shared, not copied.

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone (value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  if (ArrayBuffer.isView(value)) return value.slice()

  if (Array.isArray(value)) {
    const out = new Array(value.length)
    seen.set(value, out)
    for (let i = 0; i < value.length; i++) out[i] = deepClone(value[i], seen)
    return out
  }

  if (value instanceof Map) {
    const out = new Map()
    seen.set(value, out)
    for (const [k, v] of value) out.set(deepClone(k, seen), deepClone(v, seen))
    return out
  }

  if (value instanceof Set) {
    const out = new Set()
    seen.set(value, out)
    for (const v of value) out.add(deepClone(v, seen))
    return out
  }

  const out = Object.create(Object.getPrototypeOf(value))
  seen.set(value, out)
  for (const key of Object.keys(value)) out[key] = deepClone(value[key], seen)
  return out
}
