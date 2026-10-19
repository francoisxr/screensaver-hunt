// A pool of worker threads that run the dish simulations in parallel. The scene hands each idle worker
// the newest jobs for its dishes every frame; a slow worker just updates its dishes less often, it
// never stalls the scene.

import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { describeError } from '../core/runtime.mjs'
import { TO_WORKER, FROM_WORKER } from './worker-messages.mjs'

const WORKER_FILE = fileURLToPath(new URL('./worker.mjs', import.meta.url))

export class WorkerPool {
  /**
   * @param {object} options
   * @param {number} options.size number of threads
   * @param {string} options.programPath the play.core program every dish runs
   * @param {number} options.aspect character width / height
   * @param {string} options.playCoreDir where play.core is checked out
   * @param {(results: object[]) => void} options.onResults called with the pictures of a finished `step`
   * @param {(message: string) => void} [options.log]
   */
  constructor ({ size, programPath, aspect, playCoreDir, onResults, log = () => {} }) {
    this.onResults = onResults
    this.log = log
    /** The program's settings (colours...), once a worker has loaded it. */
    this.settings = { color: 'white', backgroundColor: 'black' }
    this.workers = Array.from({ length: size }, (_, index) => this.spawn(index, { programPath, aspect, playCoreDir }))
  }

  get size () { return this.workers.length }

  spawn (index, workerData) {
    const entry = { index, thread: new Worker(WORKER_FILE, { workerData }), ready: false, busy: false }
    entry.thread.on('message', msg => this.receive(entry, msg))
    entry.thread.on('error', e => this.log('worker crashed: ' + describeError(e)))
    entry.thread.postMessage({ t: TO_WORKER.INIT })
    return entry
  }

  receive (entry, msg) {
    switch (msg.t) {
      case FROM_WORKER.READY:
        entry.ready = true
        this.settings = msg.settings
        break
      case FROM_WORKER.SETTINGS:
        this.settings = msg.settings
        break
      case FROM_WORKER.OUT:
        entry.busy = false
        this.onResults(msg.results)
        break
      case FROM_WORKER.CLONED:
        this.log(`clone ${msg.from}->${msg.to} ${msg.ok ? 'ok' : 'FAILED (parent not ready)'}`)
        break
      case FROM_WORKER.ERROR:
        this.log('worker error: ' + msg.error)
        break
    }
  }

  /** Whether a worker can take a new `step` now. */
  canStep (index) {
    const w = this.workers[index]
    return w.ready && !w.busy
  }

  /** Runs one frame for the given jobs on one worker. */
  step (index, jobs, aspect) {
    const w = this.workers[index]
    w.busy = true
    w.thread.postMessage({ t: TO_WORKER.STEP, jobs, aspect })
  }

  /** Dish `to` starts as a copy of dish `from`, which must live on the same worker. */
  clone (index, from, to) {
    this.workers[index].thread.postMessage({ t: TO_WORKER.CLONE, from, to })
  }

  /** Every worker forgets these dishes. */
  drop (ids) {
    for (const w of this.workers) w.thread.postMessage({ t: TO_WORKER.DROP, ids })
  }

  /** The program file changed: every worker loads it again and restarts its dishes. */
  reload () {
    for (const w of this.workers) w.thread.postMessage({ t: TO_WORKER.RELOAD })
  }

  terminate () {
    for (const w of this.workers) w.thread.terminate()
  }
}
