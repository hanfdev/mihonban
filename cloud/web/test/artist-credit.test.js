import assert from 'node:assert/strict'
import test from 'node:test'

import { artistCasingChanges, artistCreditText, artistSearchText, creditsFromTags, creditsOf,
         effectiveArtistSort, hasArtist, renameArtistCredits, sameArtistNames,
         splitArtistCreditText } from '../src/artist-credit.js'

test('track credits fall back to the legacy singular artist shape', () => {
  assert.deepEqual(creditsOf({ artist: '流線形', artistSort: 'Ryusenkei' }), [
    { name: '流線形', sort: 'Ryusenkei' },
  ])
  assert.equal(hasArtist({ artist: '流線形' }, '流線形'), true)
})

test('only casing edits to existing credits need the shared-name notice', () => {
  const previous = [{ name: 'roly poly rag bear' }, { name: 'Guest' }]
  assert.deepEqual(artistCasingChanges(previous, [
    { name: 'Guest' }, { name: ' Roly Poly Rag Bear ' },
  ]), [{ from: 'roly poly rag bear', to: 'Roly Poly Rag Bear' }])
  assert.deepEqual(artistCasingChanges(previous, [
    { name: 'Guest' }, { name: 'Another Artist' },
  ]), [])
  assert.deepEqual(artistCasingChanges([], [{ name: 'Roly Poly Rag Bear' }]), [])
  assert.deepEqual(artistCasingChanges([{ name: 'Björk' }], [{ name: 'BJÖRK' }]),
    [{ from: 'Björk', to: 'BJÖRK' }])
})

test('old artist links still match after capitalization changes', () => {
  assert.equal(hasArtist({ artists: [{ name: 'Roly Poly Rag Bear' }] },
    'roly poly rag bear'), true)
  assert.equal(hasArtist({ artists: [{ name: 'BJÖRK' }] }, 'Björk'), true)
  assert.equal(hasArtist({ artists: [{ name: 'Roly Poly Rag Bear' }] },
    'Roly Poly'), false)
})

test('renaming queued credits preserves playback identity, order and metadata', () => {
  const track = { id: 'track-1', albumId: 'album-1', albumTitle: 'First',
    title: 'Song', duration: 200, path: 'Music/Library/roly poly rag bear/01.flac',
    artists: [{ name: 'roly poly rag bear', sort: 'Rag Bear, Roly Poly' },
      { name: 'Guest', sort: '' }],
    artist: 'roly poly rag bear × Guest', artistSort: 'Rag Bear, Roly Poly' }
  const renames = [{ from: 'roly poly rag bear', to: 'Roly Poly Rag Bear' }]
  const updated = renameArtistCredits(track, renames)
  assert.deepEqual(updated, { ...track,
    artists: [{ name: 'Roly Poly Rag Bear', sort: 'Rag Bear, Roly Poly' },
      { name: 'Guest', sort: '' }],
    artist: 'Roly Poly Rag Bear × Guest' })
  assert.equal(track.artists[0].name, 'roly poly rag bear')
  const unrelated = { id: 'track-2', artist: 'Guest' }
  assert.equal(renameArtistCredits(unrelated, renames), unrelated)
  assert.deepEqual(renameArtistCredits({ artist: 'roly poly rag bear',
    artistSort: 'roly poly rag bear' }, renames), {
    artist: 'Roly Poly Rag Bear', artistSort: '',
    artists: [{ name: 'Roly Poly Rag Bear', sort: '' }],
  })
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

test('ambiguous punctuation is preserved without structured identity evidence', () => {
  const combined = creditsFromTags({ artist: 'Main, Guest; Another' })
  assert.deepEqual(combined, [
    { name: 'Main, Guest; Another', sort: '' },
  ])
  assert.deepEqual(splitArtistCreditText('Neil & Iraiza', 1), ['Neil & Iraiza'])
  assert.equal(sameArtistNames(
    [{ name: 'Main' }, { name: 'Guest' }],
    [{ name: 'Guest' }, { name: 'Main' }],
  ), false)
})

test('explicit and MusicBrainz-backed collaboration text becomes ordered credits', () => {
  assert.deepEqual(creditsFromTags({ artist: 'GROOVE UNCHANT feat. pecombo' }), [
    { name: 'GROOVE UNCHANT', sort: '' },
    { name: 'pecombo', sort: '' },
  ])
  assert.deepEqual(creditsFromTags({
    artist: 'yellow mellow kite town, yummy & Shun',
    artistIds: ['one', 'two', 'three'],
  }), [
    { name: 'yellow mellow kite town', sort: '' },
    { name: 'yummy', sort: '' },
    { name: 'Shun', sort: '' },
  ])
})

test('a formal group containing Featuring remains one credit when it matches the album', () => {
  assert.deepEqual(creditsFromTags({
    artist: 'ROUND TABLE featuring Nino',
    artists: ['ROUND TABLE featuring Nino'],
    albumArtist: 'Round Table Featuring Nino',
    albumArtists: ['Round Table Featuring Nino'],
    hasStructuredArtists: false,
  }), [
    { name: 'Round Table Featuring Nino', sort: '' },
  ])
})

test('stale combined sort text is not assigned to one structured artist', () => {
  assert.deepEqual(creditsFromTags({
    artists: ['microtone', 'Nakamura Megumi'],
    artistSorts: ['microtone & Fujiiwa, Satoko', 'Nakamura Megumi'],
  }), [
    { name: 'microtone', sort: '' },
    { name: 'Nakamura Megumi', sort: '' },
  ])
})
