import test from 'node:test'
import assert from 'node:assert/strict'
import { compareRawRym, compareWeightedRym, compactRatingVotes,
         weightedRymRating } from '../src/rating-ranking.js'

const album = (rating, votes) => ({ rym: { rating, votes } })

test('weighted rating prevents a tiny sample from outranking broad consensus', () => {
  const fiveVotes = album(4.43, 5)
  const manyVotes = album(4.40, 27_207)

  assert.ok(weightedRymRating(fiveVotes.rym) < weightedRymRating(manyVotes.rym))
  assert.ok(compareWeightedRym(fiveVotes, manyVotes) > 0)
})

test('weighted rating converges on the displayed score as evidence grows', () => {
  assert.ok(Math.abs(weightedRymRating(album(4.22, 53_243).rym) - 4.22) < 0.001)
  assert.ok(weightedRymRating(album(4.43, 5).rym) < 3.5)
})

test('confidence adjustment never rewards a weak tiny sample', () => {
  assert.equal(weightedRymRating(album(2.0, 1).rym), 2.0)
  assert.ok(compareWeightedRym(album(2.0, 1), album(3.0, 10_000)) > 0)
})

test('raw rating remains available and uses votes only to break ties', () => {
  assert.ok(compareRawRym(album(4.43, 5), album(4.40, 27_207)) < 0)
  assert.ok(compareRawRym(album(4.0, 5), album(4.0, 500)) > 0)
})

test('missing ratings stay behind rated albums in either ordering', () => {
  assert.ok(compareWeightedRym(album(null, null), album(2.0, 1)) > 0)
  assert.ok(compareRawRym(album(null, null), album(2.0, 1)) > 0)
})

test('rating vote counts stay compact without losing small exact samples', () => {
  assert.equal(compactRatingVotes(5, 'en'), '5')
  assert.equal(compactRatingVotes(53_243, 'en'), '53K')
})
