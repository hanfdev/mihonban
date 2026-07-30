import test from 'node:test'
import assert from 'node:assert/strict'
import { hashOf, isCurrentHash, scrollToTop } from '../src/navigation.js'

test('navigation treats an empty hash as the album library', () => {
  assert.equal(hashOf('/'), '#/')
  assert.equal(hashOf('/tracks'), '#/tracks')
  assert.equal(isCurrentHash('/', ''), true)
  assert.equal(isCurrentHash('/', '#'), true)
  assert.equal(isCurrentHash('/tracks', '#/tracks'), true)
  assert.equal(isCurrentHash('/artists', '#/tracks'), false)
})

test('navigation scrolls the content container smoothly to its origin', () => {
  let options
  const container = { scrollTo: (next) => { options = next } }

  assert.equal(scrollToTop(container), true)
  assert.deepEqual(options, { top: 0, left: 0, behavior: 'smooth' })
  assert.equal(scrollToTop(null), false)
})
