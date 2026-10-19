// The scene's end of the socket: accepts the display clients, tracks what each reports, and sends them
// frames. It knows nothing about the simulation.
//
// Events:
//   'quit'   a client asked to stop (a key press or lost focus)
//   'empty'  the last client disconnected (after at least one had connected)

import net from 'node:net'
import { EventEmitter } from 'node:events'
import { unlinkSync } from 'node:fs'
import { MSG, encode, LineDecoder } from './protocol.mjs'

const MAX_QUEUED_BYTES = 2_000_000 // a window that falls this far behind just misses frames

export class ScreenHub extends EventEmitter {
  /**
   * @param {{ socketPath: string, log?: (message: string) => void }} options
   */
  constructor ({ socketPath, log = () => {} }) {
    super()
    this.socketPath = socketPath
    this.log = log
    /** @type {Set<import('./screens.mjs').Screen & { socket: net.Socket }>} */
    this.clients = new Set()
    this.everConnected = false
    this.server = net.createServer(socket => this.accept(socket))
  }

  listen () {
    try { unlinkSync(this.socketPath) } catch { /* no stale socket */ }
    this.server.listen(this.socketPath)
  }

  /** How many windows have said hello. */
  get readyCount () {
    return [...this.clients].filter(c => c.cols > 0).length
  }

  accept (socket) {
    const client = { socket, x: 0, name: '', cols: 0, rows: 0, aspect: 0 }
    const decoder = new LineDecoder()
    this.clients.add(client)
    this.everConnected = true
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      for (const m of decoder.push(chunk)) this.handle(client, m)
    })
    socket.on('close', () => {
      this.clients.delete(client)
      if (this.clients.size === 0) this.emit('empty')
    })
    socket.on('error', () => {})
  }

  handle (client, m) {
    if (m.t === MSG.HELLO) {
      Object.assign(client, { x: m.x, name: m.name, cols: m.cols, rows: m.rows })
      this.log(`hello ${m.name} x=${m.x} ${m.cols}x${m.rows}`)
    } else if (m.t === MSG.SIZE) {
      client.cols = m.cols
      client.rows = m.rows
    } else if (m.t === MSG.ASPECT) {
      client.aspect = m.v
      this.log(`aspect ${client.name} ${m.v.toFixed(3)}`)
    } else if (m.t === MSG.QUIT) {
      this.emit('quit')
    }
  }

  /** Sends a frame (a string of terminal codes) to one client. */
  sendFrame (client, frame) {
    this.send(client, { t: MSG.FRAME, d: frame })
  }

  send (client, message) {
    if (client.socket.destroyed || client.socket.writableLength > MAX_QUEUED_BYTES) return
    client.socket.write(encode(message))
  }

  /** Tells every client to leave the screen and exit. */
  stopAll () {
    for (const c of this.clients) this.send(c, { t: MSG.STOP })
  }

  close () {
    try { unlinkSync(this.socketPath) } catch { /* already gone */ }
    this.server.close()
  }
}
