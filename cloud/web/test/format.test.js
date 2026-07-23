import assert from 'node:assert/strict'
import test from 'node:test'

import { fmtDur, fmtTotal } from '../src/format.js'

test('track duration carries rounded seconds into the next minute', () => {
  assert.equal(fmtDur(59.6), '1:00')
  assert.equal(fmtDur(119.9), '2:00')
  assert.equal(fmtDur(266), '4:26')
})

test('track duration rejects invalid values', () => {
  assert.equal(fmtDur(null), '–:––')
  assert.equal(fmtDur(Number.POSITIVE_INFINITY), '–:––')
  assert.equal(fmtDur(-1), '–:––')
})

test('total duration carries rounded minutes into the next hour', () => {
  assert.equal(fmtTotal(7199), '2 h 0 min')
  assert.equal(fmtTotal(3599), '1 h 0 min')
  assert.equal(fmtTotal(0), '')
})
