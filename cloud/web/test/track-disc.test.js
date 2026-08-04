import assert from 'node:assert/strict'
import test from 'node:test'

import { canMoveTrackWithinDisc, groupTracksByDisc, trackDisc } from '../src/track-disc.js'

test('track disc values normalize to positive integers', () => {
  assert.equal(trackDisc({ disc: 2 }), 2)
  assert.equal(trackDisc({ disc: '3' }), 3)
  assert.equal(trackDisc({ disc: 0 }), 1)
  assert.equal(trackDisc({ disc: null }), 1)
})

test('multi-disc tracks are grouped with local positions and original indices', () => {
  const tracks = [
    { id: 'd2-a', disc: 2, track: 1 },
    { id: 'd1-a', disc: 1, track: 1 },
    { id: 'd2-b', disc: 2, track: 2 },
  ]

  assert.deepEqual(groupTracksByDisc(tracks), [
    {
      disc: 1,
      multiDisc: true,
      items: [{ track: tracks[1], index: 1, position: 1 }],
    },
    {
      disc: 2,
      multiDisc: true,
      items: [
        { track: tracks[0], index: 0, position: 1 },
        { track: tracks[2], index: 2, position: 2 },
      ],
    },
  ])
})

test('single-disc grouping remains unmarked and movement cannot cross discs', () => {
  const single = [{ id: 'a' }, { id: 'b', disc: 1 }]
  assert.equal(groupTracksByDisc(single)[0].multiDisc, false)

  const multi = [{ id: 'a', disc: 1 }, { id: 'b', disc: 1 }, { id: 'c', disc: 2 }]
  assert.equal(canMoveTrackWithinDisc(multi, 0, 1), true)
  assert.equal(canMoveTrackWithinDisc(multi, 1, 2), false)
  assert.equal(canMoveTrackWithinDisc(multi, 0, 0), false)
})
