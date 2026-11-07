import assert from 'node:assert/strict'
import test from 'node:test'

import { albumCreditsFromText, artistCasingChanges, artistCreditText, artistSearchText, creditsFromTags, creditsOf,
         effectiveArtistSort, findArtistByName, hasArtist, renameArtistCredits,
         renameArtistRecord, sameArtistNames,
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

test('old artist links resolve to the current profile after a full rename', () => {
  const current = { name: 'New Artist', aliases: ['Björk', 'Original Name'],
    note: 'Biography', hasAvatar: true }
  assert.equal(findArtistByName([current], 'BJÖRK'), current)
  assert.equal(findArtistByName([current], 'original name'), current)
  assert.equal(findArtistByName([current], 'New Artist'), current)
  assert.equal(findArtistByName([current], 'Unrelated'), undefined)
})

test('optimistic artist renames preserve metadata and searchable name history', () => {
  const original = { name: 'Current', aliases: ['First'], sort: 'Current',
    note: 'Biography', hasAvatar: true, featuredTrackCount: 3 }
  const renamed = renameArtistRecord(original, [
    { from: 'Current', to: 'New' }, { from: 'First', to: 'New' },
  ])
  assert.equal(renamed.name, 'New')
  assert.equal(renamed.sort, '')
  assert.equal(renamed.note, original.note)
  assert.equal(renamed.hasAvatar, true)
  assert.equal(renamed.featuredTrackCount, 3)
  assert.equal(findArtistByName([renamed], 'First'), renamed)
  assert.equal(findArtistByName([renamed], 'Current'), renamed)
  assert.equal(renameArtistRecord(original, [{ from: 'Other', to: 'New' }]), original)
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
  const combined = creditsFromTags({ artist: 'Main, Guest' })
  assert.deepEqual(combined, [
    { name: 'Main, Guest', sort: '' },
  ])
  assert.deepEqual(splitArtistCreditText('Neil & Iraiza', 1), ['Neil & Iraiza'])
  assert.equal(sameArtistNames(
    [{ name: 'Main' }, { name: 'Guest' }],
    [{ name: 'Guest' }, { name: 'Main' }],
  ), false)
})

test('plain "A & B" splits unless identity data or the name says it is one band', () => {
  assert.deepEqual(splitArtistCreditText('Marcos Valle & Azymuth'),
    ['Marcos Valle', 'Azymuth'])
  assert.deepEqual(splitArtistCreditText('A & B & C'), ['A', 'B', 'C'])
  assert.deepEqual(splitArtistCreditText('Kool & the Gang'), ['Kool & the Gang'])
  assert.deepEqual(splitArtistCreditText('Bob Marley & The Wailers'),
    ['Bob Marley & The Wailers'])
  assert.deepEqual(splitArtistCreditText('Earth, Wind & Fire'), ['Earth, Wind & Fire'])
  assert.deepEqual(splitArtistCreditText('Simon&Garfunkel'), ['Simon&Garfunkel'])
  assert.deepEqual(splitArtistCreditText('Marcos Valle & Azymuth', 1),
    ['Marcos Valle & Azymuth'])
  assert.deepEqual(creditsFromTags({ artist: 'Marcos Valle & Azymuth' }), [
    { name: 'Marcos Valle', sort: '' },
    { name: 'Azymuth', sort: '' },
  ])
  // Track artist equal to the album artist follows the same rule.
  assert.deepEqual(creditsFromTags({
    artist: 'Marcos Valle & Azymuth', albumArtist: 'Marcos Valle & Azymuth',
  }), [
    { name: 'Marcos Valle', sort: '' },
    { name: 'Azymuth', sort: '' },
  ])
  assert.deepEqual(creditsFromTags({
    artist: 'Neil & Iraiza', albumArtist: 'Neil & Iraiza', albumArtistIds: ['one'],
  }), [{ name: 'Neil & Iraiza', sort: '' }])
  assert.deepEqual(albumCreditsFromText('Marcos Valle & Azymuth'),
    ['Marcos Valle', 'Azymuth'])
  assert.deepEqual(albumCreditsFromText('ROUND TABLE featuring Nino'),
    ['ROUND TABLE featuring Nino'])
})

test('comma lists split only when every part reads as a full name', () => {
  assert.deepEqual(splitArtistCreditText(
    'Kazuo Ohtani, Yoshiaki Furuta, Fujimaru Yoshino, Ryo Yonemitsu'),
  ['Kazuo Ohtani', 'Yoshiaki Furuta', 'Fujimaru Yoshino', 'Ryo Yonemitsu'])
  assert.deepEqual(splitArtistCreditText('Takeshi Saito, Etsuko Yamakawa & Hideya Nakazaki'),
    ['Takeshi Saito', 'Etsuko Yamakawa', 'Hideya Nakazaki'])
  assert.deepEqual(splitArtistCreditText('山下達郎, 竹内まりや'), ['山下達郎', '竹内まりや'])
  assert.deepEqual(splitArtistCreditText('Crosby, Stills, Nash & Young'),
    ['Crosby, Stills, Nash & Young'])
  assert.deepEqual(splitArtistCreditText('Yamashita, Tatsuro'), ['Yamashita, Tatsuro'])
  assert.deepEqual(splitArtistCreditText('Bob Marley, The Wailers'),
    ['Bob Marley, The Wailers'])
  assert.deepEqual(splitArtistCreditText('Kazuo Ohtani, Yoshiaki Furuta', 1),
    ['Kazuo Ohtani, Yoshiaki Furuta'])
})

const semicolonArtists = ['Elis Regina', 'Luiz Cláudio Ramos', 'Luizão Maia',
  'Wilson das Neves', 'José Roberto Bertrami', 'Hermes Contesini']
const semicolonCredit = semicolonArtists.join('; ')
const semicolonCredits = semicolonArtists.map((name) => ({ name, sort: '' }))

test('semicolon tag credits split without relying on MusicBrainz identities', () => {
  for (const count of [0, 1, 2, semicolonArtists.length]) {
    assert.deepEqual(splitArtistCreditText(semicolonCredit, count), semicolonArtists)
    assert.deepEqual(albumCreditsFromText(semicolonCredit, count), semicolonArtists)
  }
  assert.deepEqual(creditsFromTags({ artist: semicolonCredit }), semicolonCredits)
  assert.deepEqual(creditsFromTags({
    artist: semicolonCredit, albumArtist: semicolonCredit, albumArtistIds: ['one'],
  }), semicolonCredits)
})

test('semicolon lists preserve punctuation within each artist name', () => {
  const names = ['Earth, Wind & Fire', 'Kool & the Gang', 'ROUND TABLE featuring Nino']
  assert.deepEqual(splitArtistCreditText(names.join('; ')), names)
  assert.deepEqual(albumCreditsFromText(names.join('; ')), names)
})

test('structured and repeated artist tags also split semicolon entries', () => {
  assert.deepEqual(creditsFromTags({
    artists: [semicolonCredit], hasStructuredArtists: true,
  }), semicolonCredits)
  assert.deepEqual(creditsFromTags({
    artists: [semicolonArtists.slice(0, 3).join('; '), ...semicolonArtists.slice(3)],
  }), semicolonCredits)
  assert.deepEqual(creditsFromTags({
    artist: semicolonCredit, albumArtist: semicolonCredit,
    albumArtists: [semicolonArtists.slice(0, 3).join('; '), ...semicolonArtists.slice(3)],
  }), semicolonCredits)
})

test('semicolon lists trim whitespace and omit empty and duplicate credits', () => {
  assert.deepEqual(splitArtistCreditText(' ; Elis Regina;; Luizão Maia ; '),
    ['Elis Regina', 'Luizão Maia'])
  assert.deepEqual(splitArtistCreditText(' ; ; '), [])
  assert.deepEqual(creditsFromTags({
    artists: [' ; Elis Regina ;; Luizão Maia; ', 'elis regina', ' ; '],
  }), [{ name: 'Elis Regina', sort: '' }, { name: 'Luizão Maia', sort: '' }])
})

test('semicolon sort values stay aligned and combined or mismatched sorts are discarded', () => {
  for (const artistSorts of [['Regina, Elis; Maia, Luizão'], ['Regina, Elis', 'Maia, Luizão']]) {
    assert.deepEqual(creditsFromTags({
      artists: ['Elis Regina; Luizão Maia'], hasStructuredArtists: true, artistSorts,
    }), [{ name: 'Elis Regina', sort: 'Regina, Elis' },
      { name: 'Luizão Maia', sort: 'Maia, Luizão' }])
  }
  assert.deepEqual(creditsFromTags({
    artist: 'Elis Regina; Luizão Maia', artistSort: 'Regina, Elis',
  }), [{ name: 'Elis Regina', sort: '' }, { name: 'Luizão Maia', sort: '' }])
  assert.deepEqual(creditsFromTags({
    artists: ['Elis Regina'], artistSort: 'Regina, Elis; Maia, Luizão',
  }), [{ name: 'Elis Regina', sort: '' }])
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
