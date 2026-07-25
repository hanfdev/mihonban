import assert from 'node:assert/strict'
import test from 'node:test'

import { clampMediaTime, loadAudioUntilPlayable, mediaDuration,
         mediaSessionPlaybackState, seekAudio, storedVolume,
         updateMediaPosition } from '../src/media.js'

test('a new origin starts audible while preserving an explicit zero volume', () => {
  assert.equal(storedVolume(null), 1)
  assert.equal(storedVolume(''), 1)
  assert.equal(storedVolume('not-a-number'), 1)
  assert.equal(storedVolume('0'), 0)
  assert.equal(storedVolume('1.4'), 1)
})

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

test('system playback stays paused while a remote track buffers', () => {
  let state = mediaSessionPlaybackState('loadstart', false, 'playing')
  assert.equal(state, 'paused')
  state = mediaSessionPlaybackState('play', false, state)
  assert.equal(state, 'paused')
  state = mediaSessionPlaybackState('playing', false, state)
  assert.equal(state, 'playing')
  state = mediaSessionPlaybackState('waiting', false, state)
  assert.equal(state, 'paused')
})

test('non-state media events preserve only real playback', () => {
  assert.equal(mediaSessionPlaybackState('timeupdate', false, 'playing'), 'playing')
  assert.equal(mediaSessionPlaybackState('timeupdate', false, 'paused'), 'paused')
  assert.equal(mediaSessionPlaybackState('timeupdate', true, 'playing'), 'paused')
})

test('a lock-screen track source does not start before it can play', () => {
  const listeners = new Map()
  let loadCount = 0
  let started = false
  const audio = {
    preload: 'metadata',
    src: '',
    addEventListener(event, handler) { listeners.set(event, handler) },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event)
    },
    load() { loadCount++ },
  }

  const cleanup = loadAudioUntilPlayable(audio, '/api/stream/next', () => {
    started = true
  })

  assert.equal(started, false)
  assert.equal(audio.preload, 'auto')
  assert.equal(audio.src, '/api/stream/next')
  assert.equal(loadCount, 1)
  listeners.get('canplay')()
  assert.equal(started, true)
  cleanup()
  assert.equal(listeners.has('canplay'), false)
})
