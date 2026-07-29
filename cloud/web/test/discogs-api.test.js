import assert from 'node:assert/strict'
import test from 'node:test'

import { artistDetail, discogsArtistId, discogsRef, releaseImages, releaseSearch, releaseThumbnail,
         resetDiscogsCacheForTest } from '../src/discogs-api.js'

test('browser Discogs search uses the public API and caches results', async () => {
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  const seen = []
  delete globalThis.caches
  resetDiscogsCacheForTest()
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    seen.push(url)
    return Response.json({ results: [{
      id: 42, title: 'Artist - Album', year: 1984, country: 'Japan',
      format: ['LP'], label: ['Label'], genre: ['Electronic'],
      style: ['Synth-pop'], thumb: '',
      cover_image: 'https://i.discogs.com/cover.jpeg',
    }] })
  }
  try {
    const album = { artist: 'Artist', artistSort: 'Artist', title: 'Album' }
    const first = await releaseSearch(album)
    const second = await releaseSearch(album)
    assert.equal(first.candidates[0].year, 1984)
    assert.equal(first.candidates[0].thumb, 'https://i.discogs.com/cover.jpeg')
    assert.deepEqual(second, first)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].origin, 'https://api.discogs.com')
    assert.equal(seen[0].searchParams.get('release_title'), 'Album')
    assert.equal(seen[0].searchParams.has('token'), false)
  } finally {
    globalThis.fetch = realFetch
    if (realCaches === undefined) delete globalThis.caches
    else globalThis.caches = realCaches
    resetDiscogsCacheForTest()
  }
})

test('browser Discogs search uses structured collaborator credits', async () => {
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  const seen = []
  delete globalThis.caches
  resetDiscogsCacheForTest()
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    seen.push(url.searchParams.get('artist'))
    return Response.json({ results: seen.length === 2 ? [{ id: 7 }] : [] })
  }
  try {
    const album = {
      artist: '山下達郎 × 竹内まりや', title: 'Pacific',
      artists: [
        { name: '山下達郎', sort: 'Yamashita, Tatsuro' },
        { name: '竹内まりや', sort: 'Takeuchi, Mariya' },
      ],
    }
    const result = await releaseSearch(album)
    assert.equal(result.candidates[0].id, 7)
    assert.deepEqual(seen, ['山下達郎', 'Tatsuro Yamashita'])
  } finally {
    globalThis.fetch = realFetch
    if (realCaches === undefined) delete globalThis.caches
    else globalThis.caches = realCaches
    resetDiscogsCacheForTest()
  }
})

test('browser Discogs details use stale cache during upstream rate limits', async () => {
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  const realNow = Date.now
  let now = 1_800_000_000_000
  let calls = 0
  delete globalThis.caches
  resetDiscogsCacheForTest()
  Date.now = () => now
  globalThis.fetch = async () => {
    calls += 1
    if (calls > 1) return new Response('rate limited', { status: 429 })
    return Response.json({ images: [{
      type: 'primary', uri: 'https://i.discogs.com/full.jpeg',
      uri150: 'https://i.discogs.com/thumb.jpeg', width: 600, height: 600,
    }] })
  }
  try {
    const first = await releaseImages('https://www.discogs.com/release/1-Test')
    now += 8 * 24 * 60 * 60 * 1000
    const stale = await releaseImages('1')
    assert.deepEqual(stale, first)
    assert.equal(stale.images[0].type, 'primary')
    assert.equal(calls, 2)
  } finally {
    Date.now = realNow
    globalThis.fetch = realFetch
    if (realCaches === undefined) delete globalThis.caches
    else globalThis.caches = realCaches
    resetDiscogsCacheForTest()
  }
})

test('missing search artwork is filled from the cached release details', async () => {
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  let calls = 0
  delete globalThis.caches
  resetDiscogsCacheForTest()
  globalThis.fetch = async () => {
    calls += 1
    return Response.json({ images: [{
      type: 'primary', uri: 'https://i.discogs.com/full.jpeg',
      uri150: 'https://i.discogs.com/thumb.jpeg', width: 600, height: 600,
    }] })
  }
  try {
    assert.equal(await releaseThumbnail('42'), 'https://i.discogs.com/thumb.jpeg')
    assert.equal((await releaseImages('42')).images.length, 1)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = realFetch
    if (realCaches === undefined) delete globalThis.caches
    else globalThis.caches = realCaches
    resetDiscogsCacheForTest()
  }
})

test('browser Discogs parsing rejects lookalike hosts and cleans artist profiles', async () => {
  assert.equal(discogsRef('https://discogs.com.evil.example/release/1'), null)
  assert.deepEqual(discogsRef('https://www.discogs.com/master/123-Title'), {
    kind: 'masters', id: '123',
  })
  assert.equal(discogsArtistId('42'), '42')
  assert.equal(discogsArtistId('https://www.discogs.com/artist/12-Artist-Name'), '12')
  assert.equal(discogsArtistId('discogs.com/ja/artist/34/Artist-Name'), '34')
  assert.equal(discogsArtistId('https://discogs.com.evil.example/artist/12'), null)
  assert.equal(discogsArtistId('https://www.discogs.com/release/12-Title'), null)
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  delete globalThis.caches
  resetDiscogsCacheForTest()
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.discogs.com/artists/12')
    return Response.json({
      name: 'Artist', profile: '[b]Bold[/b] [url=https://example.test]Link[/url]',
      images: [],
    })
  }
  try {
    const detail = await artistDetail('https://www.discogs.com/artist/12-Artist')
    assert.equal(detail.profile, 'Bold Link')
    await assert.rejects(
      artistDetail('https://www.discogs.com.evil.example/artist/12'),
      /Invalid Discogs artist URL or id/,
    )
  } finally {
    globalThis.fetch = realFetch
    if (realCaches === undefined) delete globalThis.caches
    else globalThis.caches = realCaches
    resetDiscogsCacheForTest()
  }
})
