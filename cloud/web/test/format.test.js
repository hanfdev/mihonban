import assert from 'node:assert/strict'
import test from 'node:test'

import { fmtBitrate, fmtDur, fmtTotal } from '../src/format.js'

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

test('bitrate stays compact without losing its unit', () => {
  assert.equal(fmtBitrate(971), '971K')
  assert.equal(fmtBitrate(1000), '1M')
  assert.equal(fmtBitrate(1022), '1.02M')
  assert.equal(fmtBitrate(1500), '1.5M')
})

test('bitrate rejects empty and invalid values', () => {
  assert.equal(fmtBitrate(null), '')
  assert.equal(fmtBitrate(''), '')
  assert.equal(fmtBitrate(Number.POSITIVE_INFINITY), '')
  assert.equal(fmtBitrate(-1), '')
})
