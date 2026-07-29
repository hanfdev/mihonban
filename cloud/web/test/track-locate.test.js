import test from 'node:test'
import assert from 'node:assert/strict'
import { centerTrackInScroller } from '../src/track-locate.js'

test('track locate corrects a materialisation shift after smooth scrolling', () => {
  let correction = null
  const scroller = {
    getBoundingClientRect: () => ({ top: 100, height: 600 }),
    scrollBy: (options) => { correction = options },
  }
  const row = {
    getBoundingClientRect: () => ({ top: 452, height: 60 }),
  }

  assert.equal(centerTrackInScroller(row, scroller), 82)
  assert.deepEqual(correction, { top: 82, left: 0, behavior: 'auto' })
})

test('track locate leaves an already centred row alone', () => {
  let calls = 0
  const scroller = {
    getBoundingClientRect: () => ({ top: 100, height: 600 }),
    scrollBy: () => { calls += 1 },
  }
  const row = {
    getBoundingClientRect: () => ({ top: 370, height: 60 }),
  }

  assert.equal(centerTrackInScroller(row, scroller), 0)
  assert.equal(calls, 0)
})
