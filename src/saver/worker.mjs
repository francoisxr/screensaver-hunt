// A worker thread: runs many copies ("dishes") of an unmodified play.core program, each with its own
// data and its own size, and answers the scene's `step` messages with the characters each one drew.
// See worker-messages.mjs for the messages.

import { parentPort, workerData } from 'node:worker_threads'
import { installPlayCoreHooks } from '../play/module-hooks.mjs'
import { installBrowserShims } from '../play/browser-shims.mjs'
import { ProgramHost } from '../play/program-host.mjs'
import { ProgramInstance } from '../play/instance.mjs'
import { TO_WORKER, FROM_WORKER } from './worker-messages.mjs'

installPlayCoreHooks(workerData.playCoreDir)
installBrowserShims()

const host = new ProgramHost(workerData.programPath, { aspect: workerData.aspect })
/** @type {Map<number, ProgramInstance>} */
const dishes = new Map()

function step ({ jobs, aspect }) {
  if (aspect) host.setAspect(aspect)
  const results = []
  for (const job of jobs) {
    let dish = dishes.get(job.id)
    if (!dish) { dish = new ProgramInstance(host); dishes.set(job.id, dish) }
    dish.resize(job.cols, job.rows)
    dish.step(job.time)
    results.push({ id: job.id, ...dish.snapshot() })
  }
  parentPort.postMessage({ t: FROM_WORKER.OUT, results })
}

function clone ({ from, to }) {
  const source = dishes.get(from)
  const ok = Boolean(source && source.booted)
  if (ok) dishes.set(to, source.clone())
  parentPort.postMessage({ t: FROM_WORKER.CLONED, from, to, ok })
}

parentPort.on('message', async msg => {
  try {
    switch (msg.t) {
      case TO_WORKER.INIT:
        await host.load()
        parentPort.postMessage({ t: FROM_WORKER.READY, settings: host.settings })
        break
      case TO_WORKER.RELOAD:
        await host.load()
        for (const dish of dishes.values()) dish.boot()
        parentPort.postMessage({ t: FROM_WORKER.SETTINGS, settings: host.settings })
        break
      case TO_WORKER.STEP:
        step(msg)
        break
      case TO_WORKER.CLONE:
        clone(msg)
        break
      case TO_WORKER.DROP:
        for (const id of msg.ids) dishes.delete(id)
        break
    }
  } catch (e) {
    parentPort.postMessage({ t: FROM_WORKER.ERROR, error: String((e && e.stack) || e) })
  }
})
