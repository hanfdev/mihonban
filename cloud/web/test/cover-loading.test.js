import assert from 'node:assert/strict'
import test from 'node:test'

import { coverLoadingProfile } from '../src/cover-loading.js'

test('phone cover loading limits eager work and keeps a short look-ahead window', () => {
  assert.deepEqual(coverLoadingProfile({ width: 390, coarsePointer: true }), {
    priorityCount: 8,
    rootMargin: '640px 0px',
  })
})

test('touch tablets preload enough covers for a wider first viewport', () => {
  assert.deepEqual(coverLoadingProfile({ width: 1024, coarsePointer: true }), {
    priorityCount: 12,
    rootMargin: '800px 0px',
  })
})

test('desktop cover loading stays ahead without restoring the old oversized burst', () => {
  assert.deepEqual(coverLoadingProfile({ width: 1920, coarsePointer: false }), {
    priorityCount: 12,
    rootMargin: '1200px 0px',
  })
})
