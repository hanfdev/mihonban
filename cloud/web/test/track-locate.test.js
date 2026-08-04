import test from 'node:test'
import assert from 'node:assert/strict'
import { centerTrackInScroller, materializeTrackListForIOS,
         locateTrackRow, trackScrollTop } from '../src/track-locate.js'

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

test('track locate computes one bounded absolute destination', () => {
  const scroller = {
    scrollTop: 400, scrollHeight: 2000, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, height: 600 }),
  }
  const row = { getBoundingClientRect: () => ({ top: 900, height: 60 }) }

  assert.equal(trackScrollTop(row, scroller), 930)
  scroller.scrollTop = 1700
  assert.equal(trackScrollTop(row, scroller), 1400)
})

test('iOS materializes the active flat list before a distant locate', () => {
  const classes = new Set()
  let layoutReads = 0
  const list = {
    classList: { add: (name) => classes.add(name) },
    get offsetHeight() { layoutReads += 1; return 20000 },
  }
  const row = { closest: (selector) => selector === '.flat-list' ? list : null }
  const ipad = { platform: 'MacIntel', maxTouchPoints: 5 }

  assert.equal(materializeTrackListForIOS(row, ipad), true)
  assert.equal(classes.has('track-locate-materialized'), true)
  assert.equal(layoutReads, 1)
  assert.equal(materializeTrackListForIOS(row,
    { platform: 'Win32', maxTouchPoints: 0 }), false)
})

test('iOS locate paints before issuing one bounded smooth scroll', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const frames = new Map()
  let nextFrame = 1
  globalThis.requestAnimationFrame = (callback) => {
    const handle = nextFrame++
    frames.set(handle, callback)
    return handle
  }
  globalThis.cancelAnimationFrame = (handle) => frames.delete(handle)

  try {
    const classes = new Set()
    const list = {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      get offsetHeight() { return 12000 },
    }
    const listeners = new Map()
    const scrollCalls = []
    const scroller = {
      scrollTop: 0,
      scrollHeight: 6000,
      clientHeight: 600,
      getBoundingClientRect: () => ({ top: 100, height: 600 }),
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type, callback) => {
        if (listeners.get(type) === callback) listeners.delete(type)
      },
      scrollTo: (options) => scrollCalls.push(options),
      scrollBy: () => {},
    }
    const row = {
      isConnected: true,
      classList: {
        add: (name) => classes.add(`row:${name}`),
        remove: (name) => classes.delete(`row:${name}`),
      },
      closest: (selector) => selector === '.flat-list' ? list : scroller,
      getBoundingClientRect: () => ({ top: 5000, height: 60 }),
      get offsetWidth() { return 100 },
    }
    const root = { querySelector: () => row }
    const ipad = { platform: 'MacIntel', maxTouchPoints: 5 }
    const runNextFrame = () => {
      const [handle, callback] = frames.entries().next().value
      frames.delete(handle)
      callback()
    }

    assert.equal(locateTrackRow('late-track', root, ipad), true)
    assert.equal(classes.has('track-locate-materialized'), true)
    assert.equal(scrollCalls.length, 0)

    runNextFrame()
    assert.equal(scrollCalls.length, 0)
    runNextFrame()
    assert.deepEqual(scrollCalls, [{ top: 4630, left: 0, behavior: 'smooth' }])

    listeners.get('scrollend')()
    runNextFrame()
    assert.equal(classes.has('row:flash'), true)
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
})
