import assert from 'node:assert/strict'
import test from 'node:test'

import { adjacentQueuePosition } from '../src/player-queue.js'

test('previous from the first track wraps to the last track in list repeat', () => {
  assert.equal(adjacentQueuePosition(0, 5, -1, 'all'), 4)
})

test('next from the last track wraps to the first track in list repeat', () => {
  assert.equal(adjacentQueuePosition(4, 5, 1, 'all'), 0)
})

test('non-repeating previous at the first track stays at the first track', () => {
  assert.equal(adjacentQueuePosition(0, 5, -1, 'off'), 0)
  assert.equal(adjacentQueuePosition(4, 5, 1, 'off'), null)
})
