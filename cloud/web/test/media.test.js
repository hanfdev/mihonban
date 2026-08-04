import assert from 'node:assert/strict'
import test from 'node:test'

import { clampMediaTime, freezeMediaSession, isIOSDevice,
         isStandaloneWebApp, loadAudioUntilPlayable, mediaDuration,
         mediaSessionPlaybackState, resolvePendingMediaSeek, seekAudio,
         shouldDeferLockScreenPlayback,
         shouldPauseForBackgroundBuffering, storedVolume,
         updateMediaPosition, volumeIconLevel } from '../src/media.js'

test('installed web apps are detected across iOS and display mode APIs', () => {
  assert.equal(isStandaloneWebApp(undefined, { standalone: true }), true)
  assert.equal(isStandaloneWebApp({
    matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' }),
  }, {}), true)
  assert.equal(isStandaloneWebApp({ matchMedia: () => ({ matches: false }) }, {}), false)
  assert.equal(isStandaloneWebApp(undefined, undefined), false)
})

test('iPadOS browser playback defers system track starts outside standalone mode', () => {
  const ipad = { platform: 'MacIntel', maxTouchPoints: 5 }
  assert.equal(isIOSDevice(ipad), true)
  assert.equal(shouldDeferLockScreenPlayback(
    { matchMedia: () => ({ matches: false }) }, ipad,
  ), true)
  assert.equal(shouldDeferLockScreenPlayback(undefined, {
    platform: 'iPhone', standalone: true,
  }), false)
  assert.equal(shouldDeferLockScreenPlayback(undefined, {
    platform: 'Linux armv8l', maxTouchPoints: 5,
  }), false)
})

test('only active hidden playback is paused when iOS runs out of buffered audio', () => {
  assert.equal(shouldPauseForBackgroundBuffering(true, 'hidden', false, false), true)
  assert.equal(shouldPauseForBackgroundBuffering(true, 'visible', false, false), false)
  assert.equal(shouldPauseForBackgroundBuffering(true, 'hidden', true, false), false)
  assert.equal(shouldPauseForBackgroundBuffering(true, 'hidden', false, true), false)
  assert.equal(shouldPauseForBackgroundBuffering(false, 'hidden', false, false), false)
  assert.equal(
    shouldPauseForBackgroundBuffering(true, 'hidden', false, false, true),
    false,
  )
})

test('track changes freeze and clear the system timeline', () => {
  let cleared = false
  const session = {
    playbackState: 'playing',
    setPositionState(value) { cleared = arguments.length === 0 && value === undefined },
  }
  assert.equal(freezeMediaSession(session), true)
  assert.equal(session.playbackState, 'paused')
  assert.equal(cleared, true)
})

test('a new origin starts audible while preserving an explicit zero volume', () => {
  assert.equal(storedVolume(null), 1)
  assert.equal(storedVolume(''), 1)
  assert.equal(storedVolume('not-a-number'), 1)
  assert.equal(storedVolume('0'), 0)
  assert.equal(storedVolume('1.4'), 1)
})

test('volume icons follow four stable loudness bands', () => {
  assert.equal(volumeIconLevel(0), 'muted')
  assert.equal(volumeIconLevel(0.02), 'low')
  assert.equal(volumeIconLevel(1 / 3), 'low')
  assert.equal(volumeIconLevel(0.34), 'medium')
  assert.equal(volumeIconLevel(2 / 3), 'medium')
  assert.equal(volumeIconLevel(0.68), 'high')
  assert.equal(volumeIconLevel(1), 'high')
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

test('system seeking publishes the requested position before Safari catches up', () => {
  let state = null
  const session = { setPositionState: (value) => { state = value } }
  const audio = { duration: 266, currentTime: 10, playbackRate: 1 }
  assert.equal(updateMediaPosition(session, audio, 266, 120), true)
  assert.deepEqual(state, { duration: 266, playbackRate: 1, position: 120 })
})

test('a pending system seek resists stale progress until audio reaches its target', () => {
  const pending = { sourceId: 'track-1', target: 120, requestedAt: 1_000 }
  assert.deepEqual(
    resolvePendingMediaSeek(pending, 'track-1', 10, false, 2_000),
    { pending, position: 120 },
  )
  assert.deepEqual(
    resolvePendingMediaSeek(pending, 'track-1', 120, true, 2_000),
    { pending, position: 120 },
  )
  assert.deepEqual(
    resolvePendingMediaSeek(pending, 'track-1', 120, false, 2_000),
    { pending: null, position: undefined },
  )
  assert.deepEqual(
    resolvePendingMediaSeek(pending, 'track-2', 10, false, 2_000),
    { pending: null, position: undefined },
  )
  assert.deepEqual(
    resolvePendingMediaSeek(pending, 'track-1', 10, false, 16_000),
    { pending: null, position: undefined },
  )
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

test('a deferred lock-screen source starts only after canplay', () => {
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
  assert.equal(listeners.has('canplay'), false)
  cleanup()
})
