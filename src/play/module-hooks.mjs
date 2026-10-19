// play.core programs import their helpers with absolute paths such as '/src/modules/vec2.js', which
// only makes sense in the browser. These hooks make Node resolve them inside a checkout of
// https://github.com/ertdfgcvb/play.core (see scripts/fetch-play-core.sh).
//
// Hooks apply to the thread that installs them, so every worker thread calls this too.

import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Where the play.core checkout lives: $PLAY_CORE_DIR, or vendor/play.core inside this project. */
export function playCoreDir (env = process.env) {
  if (env.PLAY_CORE_DIR) return env.PLAY_CORE_DIR
  return join(fileURLToPath(new URL('../../', import.meta.url)), 'vendor', 'play.core')
}

/**
 * Makes '/src/...' imports resolve inside the play.core checkout.
 * @param {string} [dir] the checkout (default: see playCoreDir)
 */
export function installPlayCoreHooks (dir = playCoreDir()) {
  registerHooks({
    resolve (specifier, context, nextResolve) {
      if (specifier.startsWith('/src/')) {
        const file = join(dir, specifier)
        if (!existsSync(file)) {
          throw new Error(`play.core is not installed at ${dir} (needed for ${specifier}). Run scripts/fetch-play-core.sh, or set PLAY_CORE_DIR.`)
        }
        return nextResolve(pathToFileURL(file).href, context)
      }
      return nextResolve(specifier, context)
    },
  })
}
