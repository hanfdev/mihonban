import assert from 'node:assert/strict'
import test from 'node:test'

import { clampMediaTime, mediaDuration, seekAudio,
         updateMediaPosition } from '../src/media.js'

test('library duration wins over Safari OGG duration estimates', () => {
  assert.equal(mediaDuration(266, 612.4), 266)
  assert.equal(mediaDuration(0, 266.25), 266.25)
  assert.equal(mediaDuration(null, Infinity), 0)
})

test('seeking clamps to the known track duration', () => {
  const audio = { duration: 900, currentTime: 0 }
  assert.equal(seekAudio(audio, 500, 266), 266)
  assert.equal(audio.currentTime, 266)
  assert.equal(clampMediaTime(-5, 266), 0)
})

test('fast system seeks use fastSeek when the browser provides it', () => {
  let target = null
  const audio = { duration: 900, currentTime: 10, fastSeek: (value) => { target = value } }
  assert.equal(seekAudio(audio, 120, 266, true), 120)
  assert.equal(target, 120)
})

test('media session receives the stable duration and a bounded position', () => {
  let state = null
  const session = { setPositionState: (value) => { state = value } }
  const audio = { duration: 900, currentTime: 500, playbackRate: 1 }
  assert.equal(updateMediaPosition(session, audio, 266), true)
  assert.deepEqual(state, { duration: 266, playbackRate: 1, position: 266 })
})
