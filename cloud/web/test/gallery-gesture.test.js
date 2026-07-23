import assert from 'node:assert/strict'
import test from 'node:test'

import { gallerySwipeDirection } from '../src/gallery-gesture.js'

test('horizontal gallery swipes select previous and next images', () => {
  assert.equal(gallerySwipeDirection({ dx: -90, dy: 8, elapsed: 300, width: 390 }), 1)
  assert.equal(gallerySwipeDirection({ dx: 90, dy: -8, elapsed: 300, width: 390 }), -1)
})

test('short or vertical gallery gestures snap back', () => {
  assert.equal(gallerySwipeDirection({ dx: 18, dy: 2, elapsed: 300, width: 390 }), 0)
  assert.equal(gallerySwipeDirection({ dx: -80, dy: 110, elapsed: 200, width: 390 }), 0)
})

test('a short fast flick still changes the image', () => {
  assert.equal(gallerySwipeDirection({ dx: -32, dy: 3, elapsed: 50, width: 390 }), 1)
})
