import assert from 'node:assert/strict'
import test from 'node:test'

import { compareArtistActivity } from '../src/artist-ranking.js'

test('artist activity ranks albums before featured-track appearances', () => {
  const twoAlbums = { count: 2, trackCount: 0, sort: 'Z' }
  const albumAndFeature = { count: 1, trackCount: 1, sort: 'A' }
  assert.ok(compareArtistActivity(twoAlbums, albumAndFeature) < 0)
})

test('featured tracks break ties only after album count', () => {
  const moreFeatures = { count: 1, trackCount: 2, sort: 'Z' }
  const fewerFeatures = { count: 1, trackCount: 1, sort: 'A' }
  assert.ok(compareArtistActivity(moreFeatures, fewerFeatures) < 0)
})
