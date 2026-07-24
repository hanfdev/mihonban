import test from 'node:test'
import assert from 'node:assert/strict'
import { playbackControlState } from '../src/player-control.js'

test('buffering keeps pause as the primary playback action', () => {
  assert.deepEqual(playbackControlState(true, true), {
    action: 'pause',
    buffering: true,
  })
})

test('a paused player never leaves a buffering indicator behind', () => {
  assert.deepEqual(playbackControlState(false, true), {
    action: 'play',
    buffering: false,
  })
})
