import assert from 'node:assert/strict'
import test from 'node:test'

import { artistCreditText, artistSearchText, creditsFromTags, creditsOf,
         effectiveArtistSort, hasArtist, sameArtistNames } from '../src/artist-credit.js'

test('track credits fall back to the legacy singular artist shape', () => {
  assert.deepEqual(creditsOf({ artist: '流線形', artistSort: 'Ryusenkei' }), [
    { name: '流線形', sort: 'Ryusenkei' },
  ])
  assert.equal(hasArtist({ artist: '流線形' }, '流線形'), true)
})

test('blank or redundant sort names stay empty while comparisons use the original name', () => {
  const blank = creditsOf({ artist: 'Fishmans', artistSort: '' })[0]
  const redundant = creditsOf({
    artists: [{ name: 'Fishmans', sort: 'Fishmans' }],
  })[0]

  assert.deepEqual(blank, { name: 'Fishmans', sort: '' })
  assert.deepEqual(redundant, { name: 'Fishmans', sort: '' })
  assert.equal(effectiveArtistSort(blank), 'Fishmans')
  assert.deepEqual(creditsFromTags({
    artist: 'Fishmans', artistSort: 'Fishmans',
  }), [
    { name: 'Fishmans', sort: '' },
  ])
  assert.match(artistSearchText({ artists: [blank] }), /Fishmans/)
})

test('ordered multi-value tags become an exact track collaboration', () => {
  const credits = creditsFromTags({
    artists: ['山下達郎', '竹内まりや'],
    artistSorts: ['Yamashita, Tatsuro', 'Takeuchi, Mariya'],
  })

  assert.deepEqual(credits, [
    { name: '山下達郎', sort: 'Yamashita, Tatsuro' },
    { name: '竹内まりや', sort: 'Takeuchi, Mariya' },
  ])
  assert.equal(artistCreditText({ artists: credits }), '山下達郎 × 竹内まりや')
  assert.match(artistSearchText({ artists: credits }), /Takeuchi, Mariya/)
})

test('combined text is never guessed apart and credit order is significant', () => {
  const combined = creditsFromTags({ artist: 'Main, Guest; Another' })
  assert.deepEqual(combined, [
    { name: 'Main, Guest; Another', sort: '' },
  ])
  assert.equal(sameArtistNames(
    [{ name: 'Main' }, { name: 'Guest' }],
    [{ name: 'Guest' }, { name: 'Main' }],
  ), false)
})
