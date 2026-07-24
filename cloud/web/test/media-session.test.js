import assert from 'node:assert/strict'
import test from 'node:test'

import { installTrackMediaSessionHandlers } from '../src/media-session.js'

test('system media controls reserve transport slots for previous and next', () => {
  const actions = new Map()
  const session = {
    setActionHandler(action, handler) { actions.set(action, handler) },
  }
  const handlers = {
    play() {},
    pause() {},
    previoustrack() {},
    nexttrack() {},
    seekto() {},
  }

  const cleanup = installTrackMediaSessionHandlers(session, handlers)

  for (const action of Object.keys(handlers)) {
    assert.equal(actions.get(action), handlers[action])
  }
  assert.equal(actions.get('seekbackward'), null)
  assert.equal(actions.get('seekforward'), null)

  cleanup()
  for (const handler of actions.values()) assert.equal(handler, null)
})

test('one unsupported action does not prevent the remaining controls', () => {
  const installed = []
  const session = {
    setActionHandler(action, handler) {
      if (action === 'seekto') throw new TypeError('unsupported')
      if (handler) installed.push(action)
    },
  }

  installTrackMediaSessionHandlers(session, {
    play() {}, pause() {}, previoustrack() {}, nexttrack() {}, seekto() {},
  })

  assert.deepEqual(installed, ['play', 'pause', 'previoustrack', 'nexttrack'])
})
