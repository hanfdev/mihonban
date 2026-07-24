import test from 'node:test'
import assert from 'node:assert/strict'
import { albumPlaybackState } from '../src/album-playback.js'

test('only the current album reflects active playback', () => {
  assert.deepEqual(albumPlaybackState('album-a', 'album-a', 'track-1'), {
    current: true,
    playing: true,
  })
  assert.deepEqual(albumPlaybackState('album-b', 'album-a', 'track-1'), {
    current: false,
    playing: false,
  })
})

test('the current album returns to a play action while paused', () => {
  assert.deepEqual(albumPlaybackState('album-a', 'album-a', null), {
    current: true,
    playing: false,
  })
})
