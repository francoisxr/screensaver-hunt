// play.core programs are written for the browser and occasionally touch a DOM global (for example
// `document.body.style.cursor = 'crosshair'` in boot). These stand-ins make that harmless.

const noop = () => {}

export function installBrowserShims (target = globalThis) {
  target.document = {
    body: { style: {} },
    addEventListener: noop,
    querySelector: () => null,
    fonts: { ready: Promise.resolve() },
  }
  target.window = target.window || target
  target.requestAnimationFrame = target.requestAnimationFrame || (f => setTimeout(() => f(performance.now()), 0))
}
