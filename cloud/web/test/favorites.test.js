import assert from 'node:assert/strict'
import test from 'node:test'

import { addFavoriteToFront } from '../src/favorites.js'

test('new favorites appear first without disturbing the existing manual order', () => {
  const current = [
    { id: 'first', ts: 10, order: 0 },
    { id: 'second', ts: 9, order: 1 },
  ]

  assert.deepEqual(addFavoriteToFront(current, 'new', 11), [
    { id: 'new', ts: 11, order: -1 },
    ...current,
  ])
})

test('the first favorite starts a manually adjustable order', () => {
  assert.deepEqual(addFavoriteToFront([], 'only', 12), [
    { id: 'only', ts: 12, order: 0 },
  ])
})
