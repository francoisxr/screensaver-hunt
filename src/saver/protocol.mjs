// The messages between the scene (one process that runs the simulation) and the display clients (one
// per monitor window). They travel over a unix socket, one JSON object per line.
//
//   client -> scene   hello   { x, name, cols, rows }   first message: where the monitor is, and its size in cells
//                     size    { cols, rows }             the window was resized
//                     aspect  { v }                      measured character width / height
//                     quit                               a key was pressed, or focus was lost: stop everything
//   scene -> client   f       { d }                      a frame: a string of terminal codes to print
//                     q                                  stop: leave the screen and exit

export const MSG = Object.freeze({
  HELLO: 'hello',
  SIZE: 'size',
  ASPECT: 'aspect',
  QUIT: 'quit',
  FRAME: 'f',
  STOP: 'q',
})

/** One message as a line of the wire format. */
export const encode = message => JSON.stringify(message) + '\n'

/** Splits a stream of text chunks into messages. Lines that are not valid JSON are skipped. */
export class LineDecoder {
  constructor () {
    this.buffer = ''
  }

  /**
   * @param {string} chunk text as it arrived (it may end in the middle of a line)
   * @returns {object[]} the complete messages in it
   */
  push (chunk) {
    this.buffer += chunk
    const messages = []
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      try { messages.push(JSON.parse(line)) } catch { /* skip garbage */ }
    }
    return messages
  }
}
