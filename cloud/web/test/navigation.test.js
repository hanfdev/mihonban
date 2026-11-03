import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hashOf, isCurrentHash, restoreScroll, scrollMemoryKey, scrollToTop,
} from '../src/navigation.js'

test('navigation treats an empty hash as the album library', () => {
  assert.equal(hashOf('/'), '#/')
  assert.equal(hashOf('/tracks'), '#/tracks')
  assert.equal(hashOf('/admin'), '#/admin')
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

test('only top-level browsing pages get their own scroll memory', () => {
  assert.equal(scrollMemoryKey(''), '#/')
  assert.equal(scrollMemoryKey('#/'), '#/')
  assert.equal(scrollMemoryKey('#/tracks'), '#/tracks')
  assert.equal(scrollMemoryKey('#/artists'), '#/artists')
  assert.equal(scrollMemoryKey('#/favs/tracks'), '#/favs/tracks')
  assert.equal(scrollMemoryKey('#/genre/Jazz'), '#/genre/Jazz')
  assert.equal(scrollMemoryKey('#/album/abc'), null)
  assert.equal(scrollMemoryKey('#/artist/Azymuth'), null)
  assert.equal(scrollMemoryKey('#/admin'), null)
})

test('scroll restore waits until the page can reach the saved position', () => {
  const frames = []
  let clock = 0
  const container = { scrollHeight: 500, clientHeight: 400, _top: 0,
    get scrollTop() { return this._top },
    set scrollTop(value) {
      this._top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))
    } }
  restoreScroll(container, 900, { frame: (cb) => frames.push(cb),
    cancelFrame: () => {}, now: () => clock })
  frames.shift()()
  assert.equal(container.scrollTop, 100)
  assert.equal(frames.length, 1)
  container.scrollHeight = 2000
  frames.shift()()
  assert.equal(container.scrollTop, 900)
  assert.equal(frames.length, 0)
})

test('scroll restore gives up after its timeout or when cancelled', () => {
  const frames = []
  let clock = 0
  const container = { scrollHeight: 500, clientHeight: 400, scrollTop: 0 }
  restoreScroll(container, 900, { timeout: 100, frame: (cb) => frames.push(cb),
    cancelFrame: () => {}, now: () => clock })
  clock = 200
  frames.shift()()
  assert.equal(frames.length, 0)

  let cancelled = null
  const stop = restoreScroll(container, 900, { frame: () => 7,
    cancelFrame: (id) => { cancelled = id }, now: () => clock })
  stop()
  assert.equal(cancelled, 7)
})
