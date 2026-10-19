import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseColor, mixRgb } from '../src/core/color.mjs'
import { fgRgb, bgRgb, fgCss, bgCss, ENTER_SCREEN, LEAVE_SCREEN, HOME } from '../src/core/ansi.mjs'
import { gridToAnsi } from '../src/core/frame.mjs'

test('parseColor understands hex, short hex, rgb(), names; rejects the rest', () => {
  assert.deepEqual(parseColor('#ff8000'), [255, 128, 0])
  assert.deepEqual(parseColor('#f80'), [255, 136, 0])
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3])
  assert.deepEqual(parseColor('rgba(10 20 30 / 0.5)'), [10, 20, 30])
  assert.deepEqual(parseColor('white'), [255, 255, 255])
  assert.deepEqual(parseColor(' Black '), [0, 0, 0])
  assert.equal(parseColor('not a colour'), null)
  assert.equal(parseColor(null), null)
})

test('mixRgb', () => {
  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25])
  assert.deepEqual(mixRgb([10, 10, 10], [20, 20, 20], 0), [10, 10, 10])
})

test('colour sequences', () => {
  assert.equal(fgRgb([1, 2, 3]), '\x1b[38;2;1;2;3m')
  assert.equal(bgRgb([4, 5, 6]), '\x1b[48;2;4;5;6m')
  assert.equal(fgCss('#010203'), '\x1b[38;2;1;2;3m')
  assert.equal(fgCss('nonsense'), '\x1b[39m') // the terminal's default
  assert.equal(bgCss('nonsense'), '\x1b[49m')
  assert.ok(ENTER_SCREEN.includes('?1049h') && ENTER_SCREEN.includes('?25l'))
  assert.ok(LEAVE_SCREEN.includes('?1049l') && LEAVE_SCREEN.includes('?25h'))
})

test('gridToAnsi: home first, rows joined by CR LF, colour only changes where it changes', () => {
  const defaults = { color: 'white', backgroundColor: 'black' }
  const grid = [
    { char: 'a' }, { char: 'b' },
    null, { char: 'c', rgb: [9, 9, 9], bold: true },
  ]
  const out = gridToAnsi(grid, 2, 2, defaults)
  assert.ok(out.startsWith(HOME))
  assert.equal(out.split('\r\n').length, 2)
  assert.equal(out.split('\x1b[38;2;255;255;255m').length - 1, 1) // white set once for a, b and the empty cell
  assert.ok(out.includes('\x1b[1m\x1b[38;2;9;9;9mc'))
  assert.ok(!out.endsWith('\r\n'))
})

test('gridToAnsi: empty cells are spaces; a cell can set its own background', () => {
  const out = gridToAnsi([null, { char: 'x', back: '#112233' }], 2, 1, { color: 'white', backgroundColor: 'black' })
  assert.ok(out.includes(' ') && out.includes('\x1b[48;2;17;34;51mx'))
})

test('gridToAnsi: bold is switched off again', () => {
  const out = gridToAnsi([{ char: 'a', bold: true }, { char: 'b' }], 2, 1, { color: 'white', backgroundColor: 'black' })
  assert.ok(out.indexOf('\x1b[22m') > out.indexOf('\x1b[1m'))
})
