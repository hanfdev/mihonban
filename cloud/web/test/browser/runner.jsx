import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../../src/i18n.jsx'
import { ToastHost } from '../../src/ui.jsx'
import BaselineFavorites from 'baseline:Favorites'
import CurrentFavorites from 'current:Favorites'
import BaselineArtist from 'baseline:Artist'
import CurrentArtist from 'current:Artist'
import BaselineLibrary from 'baseline:Library'
import CurrentLibrary from 'current:Library'
import BaselineArtists from 'baseline:Artists'
import CurrentArtists from 'current:Artists'
import CurrentImport from 'current:Import'

// These are mounted source components, not rewritten copies of their algorithms.
const components = {
  Favorites: [BaselineFavorites, CurrentFavorites], Artist: [BaselineArtist, CurrentArtist],
  Library: [BaselineLibrary, CurrentLibrary], Artists: [BaselineArtists, CurrentArtists],
  Import: [null, CurrentImport],
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let counts
const resetCounts = () => { counts = { rows: {}, normalization: 0, haystacks: 0, sorts: 0, comparisons: 0 } }
resetCounts()
globalThis.__perfRow = (id) => { counts.rows[id] = (counts.rows[id] || 0) + 1 }
globalThis.__perfNorm = (s) => {
  counts.normalization++
  if (String(s).length > 30) counts.haystacks++
}
Object.defineProperty(Array.prototype, '__perfSort', {
  configurable: true,
  value(compare) {
    counts.sorts++
    return this.sort(compare && ((a, b) => { counts.comparisons++; return compare(a, b) }))
  },
})
const cloneCounts = () => structuredClone(counts)
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`)
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const noop = () => {}
const container = document.getElementById('fixture')
let activeRoot = null
let fetchFixture = null
let fetchCalls = []
let unexpectedFetches = []
const originalFetch = window.fetch
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  fetchCalls.push(url.pathname + url.search)
  if ((init.method || 'GET') !== 'GET') throw new Error(`Unexpected write ${url.pathname}`)
  let body
  if (/^\/api\/artists\/[^/]+\/tracks$/.test(url.pathname)) {
    body = fetchFixture.tracks.filter((track) => url.searchParams.has('hidden') || !track.hidden)
  } else if (/^\/api\/album\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').pop())
    body = { ...fetchFixture.albums.find((a) => a.id === id),
      tracks: fetchFixture.tracks.filter((track) => track.albumId === id) }
  } else {
    unexpectedFetches.push(url.href)
    throw new Error(`Unmocked request blocked: ${url.href}`)
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fixture(unsafe = false) {
  const names = ['Common A', 'Common B', 'Solo C', 'Common D', '周杰倫', 'Hidden Artist']
  const albums = Array.from({ length: 18 }, (_, i) => ({
    id: `a${i}`, title: i === 4 ? '愛樂 國語' : `${i % 3 === 0 ? 'Solo' : 'Common'} Album ${i % 4}`,
    artist: names[i % names.length], artistSort: names[i % names.length],
    artists: [{ name: names[i % names.length], sort: names[i % names.length] }],
    year: i % 5 === 0 ? undefined : 1990 + i % 3,
    createdAt: 100 + i % 4,
    updatedAt: i % 5 === 0 && unsafe ? undefined : 100 + i % 4,
    genres: [i % 2 ? 'Jazz' : 'Rock'], secondaryGenres: ['Ambient'],
    hidden: i % 6 === 5, duration: 120,
    rym: i % 4 === 0 ? undefined : { rating: 3.5 + (i % 3) / 10, votes: 50 + i % 2 },
  }))
  if (unsafe) {
    albums[1] = { ...albums[1], year: 'unknown', updatedAt: 'unknown' }
    albums[6] = { ...albums[6], year: Infinity, updatedAt: Infinity }
    albums[8] = { ...albums[8], year: NaN, updatedAt: NaN }
  }
  const tracks = albums.map((a, i) => ({
    ...a, id: `t${i}`, albumId: a.id, albumTitle: a.title,
    title: i === 4 ? '愛樂 國語' : `${i % 3 === 0 ? 'Solo' : 'Common'} Track ${i % 4}`,
    track: unsafe && i === 2 ? 'unknown' : i % 4 === 0 ? undefined : i % 3,
    duration: 120 + i, version: 1,
  }))
  const artists = names.map((name, i) => ({ name, sort: name, aliases: [`Alias${i}`],
    hasAvatar: false, featuredTrackCount: unsafe && i === 1 ? 'unknown' : i + 1,
    visibleFeaturedTrackCount: unsafe && i === 1 ? 'unknown' : i,
  }))
  const favs = {
    albums: [...albums].reverse().map(({ id }) => ({ id })).concat({ id: 'gone-album' }),
    tracks: [...tracks].reverse().map(({ id }) => ({ id })).concat({ id: 'gone-track' }),
  }
  return { albums, tracks, artists, favs }
}

async function mount(kind, variant, data, extra = {}) {
  localStorage.setItem('mihonban_language', 'en')
  localStorage.removeItem('mihonban_favorite_album_sort')
  localStorage.removeItem('mihonban_favorite_track_sort')
  fetchFixture = data
  const events = { queues: [], favorites: [], albums: [], artists: [], reorders: [] }
  let props = {
    ...data, q: '', tab: 'tracks', name: 'Common A', favTracks: new Set(),
    isAdmin: true, showHidden: false, avatarVer: 0,
    currentId: null, playingId: null, currentAlbumId: null, playerShuffle: false,
    ensureTracks: noop, onOpen: (id) => events.albums.push(id),
    onOpenArtist: (name) => events.artists.push(name), onOpenGenre: noop,
    onPlay: noop, onAvatarChanged: noop, onArtistChanged: noop,
    onTogglePlayback: noop, onTabChange: noop, onClearQuery: noop,
    toggleFav: (kind, id) => events.favorites.push([kind, id]),
    onPlayTracks: (queue, index, options) => events.queues.push({
      queue: queue.map(({ id, title, version }) => ({ id, title, version })), index, options,
    }),
    onReorder: (kind, ids) => events.reorders.push({ kind, ids }),
    ...extra,
  }
  const Component = components[kind][variant]
  const root = createRoot(container)
  activeRoot = root
  const render = async (patch = {}) => {
    props = { ...props, ...patch }
    await act(async () => { root.render(<I18nProvider><ToastHost><Component {...props} /></ToastHost></I18nProvider>) })
  }
  props.setShowHidden = (value) => {
    props = { ...props, showHidden: typeof value === 'function' ? value(props.showHidden) : value }
    root.render(<I18nProvider><ToastHost><Component {...props} /></ToastHost></I18nProvider>)
  }
  await render()
  return {
    events, render, props: () => props,
    async dispose() { await act(async () => root.unmount()); activeRoot = null },
  }
}
async function click(element) {
  assert(element, 'Missing clickable DOM element')
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}
async function waitForDom(predicate, message, timeout = 3000) {
  const deadline = performance.now() + timeout
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(message)
    // Fetch Response.json() can finish on a later task after the click's act flush.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
}
async function select(value, selector = '.sort-sel') {
  const element = container.querySelector(selector)
  assert(element && [...element.options].some((o) => o.value === value), `Missing option ${value}`)
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })) })
}
const trackIds = () => [...container.querySelectorAll('.trow[data-tid]')].map((row) => row.dataset.tid)
async function snapshot(kind, mounted) {
  if (kind === 'Favorites' && mounted.props().tab === 'tracks') return trackIds()
  if (kind === 'Artist') return trackIds()
  if (kind === 'Artists') return [...container.querySelectorAll('.acard-name')].map((e) => e.textContent)
  const start = mounted.events.albums.length
  for (const title of container.querySelectorAll(kind === 'Import' ? '.recent-item' : '.card-title')) await click(title)
  return mounted.events.albums.slice(start)
}
const sorts = {
  Library: ['rating', 'ratingRaw', 'artist', 'title', 'yearNew', 'yearOld', 'added'],
  Artists: ['count', 'name', 'added'],
  FavoritesTracks: ['fav', 'title', 'artist', 'album', 'yearNew', 'yearOld'],
  FavoritesAlbums: ['fav', 'artist', 'title', 'yearNew', 'yearOld'],
}
const queries = ['', 'Common', 'Solo', '爱乐', 'Alias0', '  common  ', 'not-present']

async function orderedScenario(kind, variant, data, tab = 'tracks') {
  const mounted = await mount(kind, variant, data, { tab })
  const snapshots = []
  // Recently-added semantics intentionally changed after this baseline. Test
  // those against explicit expectations below, not the old update-time order.
  const keys = sorts[kind === 'Favorites' ? `Favorites${tab === 'tracks' ? 'Tracks' : 'Albums'}` : kind]
    .filter((key) => key !== 'added')
  for (const sort of keys) {
    await select(sort)
    for (const q of queries) {
      await mounted.render({ q })
      snapshots.push({ sort, q, ids: await snapshot(kind, mounted) })
      if (kind === 'Favorites' && tab === 'tracks' && trackIds().length) {
        await click(container.querySelectorAll('.trow')[Math.min(1, trackIds().length - 1)])
        snapshots.push({ click: mounted.events.queues.at(-1) })
      }
    }
  }
  if (kind === 'Library' || kind === 'Artists') {
    await mounted.render({ q: '' })
    await click(container.querySelector('.visibility-toggle'))
    snapshots.push({ hidden: await snapshot(kind, mounted) })
    assert(kind !== 'Artists' || (await snapshot(kind, mounted)).includes('Hidden Artist'), 'Hidden artist fixture not shown')
    await mounted.render({ isAdmin: false })
    snapshots.push({ public: await snapshot(kind, mounted) })
    assert(!container.querySelector('.card.is-hidden, .acard.is-hidden'), 'Hidden item leaked to public view')
  }
  if (kind !== 'Favorites' || tab === 'albums') {
    await mounted.render({ q: '', isAdmin: true, showHidden: true })
    const filters = [...container.querySelectorAll('select:not(.sort-sel)')]
    for (let i = 0; i < filters.length; i++) {
      const values = [...filters[i].options].map((option) => option.value)
      if (values.length < 2) continue
      const value = values[1]
      const selector = `select:not(.sort-sel)`
      await act(async () => {
        const filter = container.querySelectorAll(selector)[i]
        filter.value = value
        filter.dispatchEvent(new Event('change', { bubbles: true }))
      })
      snapshots.push({ filter: i, value, ids: await snapshot(kind, mounted) })
      await act(async () => {
        const filter = container.querySelectorAll(selector)[i]
        filter.value = values[0]
        filter.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
  }
  await mounted.dispose()
  return snapshots
}

async function recentlyAddedScenario(kind) {
  const album = (id, artist, createdAt, updatedAt = createdAt, hidden = false) => ({
    id, title: id, artist, artistSort: artist, artists: [{ name: artist, sort: artist }],
    createdAt, updatedAt, hidden, genres: [], secondaryGenres: [],
  })
  const albums = [
    album('c-old', 'Old Artist', 100),
    album('b-newer', 'Newer Artist', 200),
    album('a-tie', 'Tie Artist', 200),
    album('d-older', 'Older Artist', 50),
    album('e-unknown', 'Unknown Artist', undefined, 900),
    album('f-hidden', 'Old Artist', 500, 500, true),
  ]
  const data = { albums, artists: [], tracks: [], favs: { albums: [], tracks: [] } }
  const mounted = await mount(kind, 1, data)
  if (kind !== 'Import') await select('added')
  const expected = kind === 'Artists'
    ? ['Newer Artist', 'Tie Artist', 'Old Artist', 'Older Artist', 'Unknown Artist']
    : [...(kind === 'Import' ? ['f-hidden'] : []), 'a-tie', 'b-newer', 'c-old', 'd-older', 'e-unknown']
  equal(await snapshot(kind, mounted), expected, `${kind}: wrong original addition order`)
  const edited = albums.map((a) => a.id === 'c-old'
    ? { ...a, title: 'Corrected old title', updatedAt: 1000, rym: { rating: 5, votes: 1000 } } : a).reverse()
  await mounted.render({ albums: edited })
  equal(await snapshot(kind, mounted), expected, `${kind}: editing or refreshing moved an old album`)

  const imported = [...edited, album('g-imported', 'Old Artist', 300)]
  await mounted.render({ albums: imported })
  const afterImport = kind === 'Artists'
    ? ['Old Artist', 'Newer Artist', 'Tie Artist', 'Older Artist', 'Unknown Artist']
    : kind === 'Import'
      ? ['f-hidden', 'g-imported', 'a-tie', 'b-newer', 'c-old', 'd-older']
      : ['g-imported', ...expected]
  equal(await snapshot(kind, mounted), afterImport, `${kind}: new import not reflected in addition order`)
  if (kind !== 'Import') {
    await mounted.render({ showHidden: true })
    equal(await snapshot(kind, mounted), kind === 'Artists' ? afterImport : ['f-hidden', ...afterImport],
      `${kind}: hidden additions not reflected when explicitly shown`)
    await mounted.render({ isAdmin: false })
    equal(await snapshot(kind, mounted), afterImport, `${kind}: hidden additions affected public order`)
  }
  await mounted.dispose()
  return { original: expected, afterImport }
}

async function rowScenario(kind, variant) {
  const data = fixture()
  const mounted = await mount(kind, variant, data)
  const ids = trackIds()
  assert(ids.length > 3, `${kind} did not mount real track rows`)
  resetCounts()
  await mounted.render({ currentId: ids[0], playingId: ids[0] })
  const start = cloneCounts()
  resetCounts()
  await mounted.render({ playingId: null })
  const pause = cloneCounts()
  resetCounts()
  await mounted.render({ currentId: ids[1], playingId: ids[1] })
  const next = cloneCounts()
  if (variant === 1) {
    equal(Object.keys(start.rows), [ids[0]], `${kind}: unrelated rows rendered on playback start`)
    equal(Object.keys(pause.rows), [ids[0]], `${kind}: unrelated rows rendered on pause`)
    equal(Object.keys(next.rows).sort(), [ids[0], ids[1]].sort(), `${kind}: unrelated rows rendered on track change`)
  } else {
    assert(Object.keys(start.rows).length === ids.length, 'Baseline row counter failed its positive control')
  }
  await click(container.querySelectorAll('.trow')[2])
  equal(mounted.events.queues.at(-1).queue.map((t) => t.id), ids, `${kind}: wrong initial queue`)
  equal(mounted.events.queues.at(-1).index, 2, `${kind}: wrong initial start index`)
  await click(container.querySelectorAll('.t-heart button')[2])
  equal(mounted.events.favorites.at(-1), ['track', ids[2]], `${kind}: wrong favorite ID`)
  const replacementCalls = []
  await mounted.render({
    onPlayTracks: (queue, index) => replacementCalls.push({ ids: queue.map((t) => t.id), index }),
    toggleFav: (kind, id) => replacementCalls.push({ kind, id }),
  })
  await click(container.querySelectorAll('.trow')[1])
  await click(container.querySelectorAll('.t-heart button')[1])
  equal(replacementCalls, [{ ids, index: 1 }, { kind: 'track', id: ids[1] }], `${kind}: stale parent callbacks`)
  await mounted.dispose()
  return { start, pause, next }
}

async function queryWork(kind, variant, tab = 'tracks') {
  const data = fixture()
  const mounted = await mount(kind, variant, data, { tab })
  await select(kind === 'Artists' ? 'name' : 'title')
  resetCounts()
  for (const q of ['Common', 'Common T', 'Common', 'Solo', '']) await mounted.render({ q })
  const result = cloneCounts()
  if (variant === 1) {
    equal(result.comparisons, 0, `${kind}/${tab}: query-only updates repeated sorting`)
    equal(result.haystacks, 0, `${kind}/${tab}: query-only updates rebuilt haystacks`)
    assert(result.normalization <= 10, `${kind}/${tab}: too many query normalizations`)
  } else {
    assert(result.comparisons > 0, 'Baseline comparator counter failed its positive control')
    if (kind === 'Favorites') assert(result.haystacks > 0, 'Baseline normalization counter failed its positive control')
  }
  await mounted.dispose()
  return result
}

async function favoritesRefresh(variant) {
  const data = fixture()
  const mounted = await mount('Favorites', variant, data)
  equal(trackIds(), data.favs.tracks.filter((f) => f.id !== 'gone-track').map((f) => f.id), 'Backend favorite order changed')
  const reversed = [...data.favs.tracks].reverse()
  await mounted.render({ favs: { ...data.favs, tracks: reversed } })
  const order = trackIds()
  await click(container.querySelectorAll('.trow')[2])
  equal(mounted.events.queues.at(-1).queue.map((t) => t.id), order, 'Favorite reorder used stale queue')
  const tracks = data.tracks.map((t) => ({ ...t, title: `Refreshed ${t.title}`, version: 2 }))
  await mounted.render({ tracks })
  await click(container.querySelectorAll('.trow')[2])
  assert(mounted.events.queues.at(-1).queue.every((t) => t.version === 2), 'Refreshed queue retained old objects')
  await mounted.render({ q: 'Solo' })
  await select('yearNew')
  const filtered = trackIds()
  await click(container.querySelector('.trow'))
  equal(mounted.events.queues.at(-1).queue.map((t) => t.id), filtered, 'Filtered/sorted click used stale queue')
  const result = mounted.events.queues
  await mounted.dispose()
  return result
}

async function favoritesDrag(variant, tab) {
  const data = fixture()
  const mounted = await mount('Favorites', variant, data, { tab })
  const before = await snapshot('Favorites', mounted)
  const selector = tab === 'tracks' ? '.fav-trow' : '.fav-card'
  const items = container.querySelectorAll(selector)
  const handle = items[0].querySelector('[data-drag-handle]')
  assert(innerWidth > 0 && innerHeight > 0,
    'Real pointer hit-testing requires a visible preview pane or an explicit preview viewport')
  items[1].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = items[1].getBoundingClientRect()
  // Use the visible portion, including narrow panes and horizontally clipped rows.
  const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
  const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
  assert(right > left && bottom > top, 'Drag destination outside the viewport after scrolling')
  const x = (left + right) / 2, y = (top + bottom) / 2
  assert(document.elementFromPoint(x, y)?.closest(selector) === items[1], 'Drag destination not visible')
  await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, button: 0 })))
  await act(async () => items[0].dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 41, clientX: x, clientY: y })))
  const expected = [...before]
  expected.splice(1, 0, expected.splice(0, 1)[0])
  equal(await snapshot('Favorites', mounted), expected, 'Live pointer reorder did not update displayed order')
  if (tab === 'tracks') {
    await click(container.querySelector('.trow'))
    equal(mounted.events.queues.at(-1).queue.map((t) => t.id), expected, 'Live drag click used pre-drag queue')
  }
  await act(async () => items[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41 })))
  equal(mounted.events.reorders, [{ kind: tab === 'tracks' ? 'track' : 'album', ids: expected }], 'Pointer commit IDs incorrect')
  const key = tab === 'tracks' ? 'tracks' : 'albums'
  await mounted.render({ favs: { ...data.favs, [key]: expected.map((id) => ({ id })) } })
  equal(await snapshot('Favorites', mounted), expected, 'Persisted drag order lost')
  await mounted.render({ q: 'Common' })
  assert(!container.querySelector('[data-drag-handle]'), 'Dragging remained enabled during search')
  await mounted.dispose()
  return { before, expected }
}

async function artistRefresh(variant) {
  const data = fixture()
  fetchCalls = []
  const mounted = await mount('Artist', variant, data)
  const visible = trackIds()
  equal(visible, data.tracks.filter((t) => !t.hidden).map((t) => t.id), 'Featured fetch fixture not rendered')
  const refreshed = data.tracks.map((t) => ({ ...t, title: `Fresh ${t.title}`, version: 2 }))
  fetchFixture = { ...data, tracks: [...refreshed].reverse() }
  await click(container.querySelector('.visibility-toggle'))
  const expected = [...refreshed].reverse().map((t) => t.id)
  await waitForDom(() => JSON.stringify(trackIds()) === JSON.stringify(expected),
    `Featured visibility refetch did not settle: expected ${expected.join(',')}`)
  const all = trackIds()
  equal(all, expected, 'Featured visibility refetch order wrong')
  await click(container.querySelectorAll('.trow')[2])
  const queue = mounted.events.queues.at(-1)
  equal(queue.queue.map((t) => t.id), all, 'Featured refetch used stale queue')
  assert(queue.queue.every((t) => t.version === 2), 'Featured refetch retained old track objects')
  assert(fetchCalls.some((url) => url.endsWith('?hidden=1')), 'Artist hidden request missing')
  await mounted.dispose()
  return { visible, all, queue, requests: [...fetchCalls] }
}

async function runPerformanceTests() {
  if (window.performanceTestResults?.status === 'running') return window.performanceTestResults
  const storageKeys = ['mihonban_language', 'mihonban_favorite_album_sort', 'mihonban_favorite_track_sort']
  const storage = storageKeys.map((key) => [key, localStorage.getItem(key)])
  const results = { status: 'running', passed: 0, failed: 0, tests: [], startedAt: new Date().toISOString() }
  window.performanceTestResults = results
  unexpectedFetches = []
  const report = () => {
    document.getElementById('status').textContent = `${results.status}: ${results.passed} passed, ${results.failed} failed`
    document.getElementById('report').textContent = JSON.stringify(results, null, 2)
  }
  const test = async (name, fn) => {
    try { const detail = await fn(); results.tests.push({ name, passed: true, detail }); results.passed++ }
    catch (error) { results.tests.push({ name, passed: false, error: error.stack || String(error) }); results.failed++ }
    finally {
      if (activeRoot) { await act(async () => activeRoot.unmount()); activeRoot = null }
      report()
    }
  }
  report()
  try {
    for (const unsafe of [false, true]) {
      for (const [kind, tab] of [['Library', 'albums'], ['Artists', 'albums'], ['Favorites', 'albums'], ['Favorites', 'tracks']]) {
        await test(`${kind}/${tab}: unchanged sorts, queries, filters, ${unsafe ? 'unsafe numerics' : 'ties/missing fields'}`, async () => {
          const data = fixture(unsafe)
          const baseline = await orderedScenario(kind, 0, data, tab)
          const current = await orderedScenario(kind, 1, data, tab)
          equal(current, baseline, 'Ordered DOM or clicked queue diverged from baseline')
          return { comparedSnapshots: baseline.length }
        })
      }
    }
    for (const kind of ['Library', 'Artists', 'Import']) {
      await test(`${kind}: edits preserve addition order and new imports advance it`,
        () => recentlyAddedScenario(kind))
    }
    for (const kind of ['Favorites', 'Artist']) {
      await test(`${kind}: stable real TrackRow render counts and callbacks`, async () => ({
        baseline: await rowScenario(kind, 0), current: await rowScenario(kind, 1),
      }))
    }
    for (const [kind, tab] of [['Favorites', 'tracks'], ['Favorites', 'albums'], ['Library', 'albums'], ['Artists', 'albums']]) {
      await test(`${kind}/${tab}: query-only normalization and comparison counts`, async () => ({
        baseline: await queryWork(kind, 0, tab), current: await queryWork(kind, 1, tab),
      }))
    }
    await test('Favorites: reorder and refresh click queues', async () => {
      const baseline = await favoritesRefresh(0), current = await favoritesRefresh(1)
      equal(current, baseline, 'Favorites refresh callbacks diverged')
      return { comparedQueues: baseline.length }
    })
    for (const tab of ['tracks', 'albums']) await test(`Favorites/${tab}: actual pointer drag and commit`, async () => {
      const baseline = await favoritesDrag(0, tab), current = await favoritesDrag(1, tab)
      equal(current, baseline, 'Pointer reorder diverged')
      return current
    })
    await test('Artist: visibility refetch and latest featured click queue', async () => {
      const baseline = await artistRefresh(0), current = await artistRefresh(1)
      equal(current, baseline, 'Artist refetch callbacks diverged')
      return { comparedTracks: current.all.length, requests: current.requests }
    })
    await test('Network isolation', async () => {
      equal(unexpectedFetches, [], 'Unexpected network requests were attempted')
      assert([...container.querySelectorAll('img')].every((im) => !im.src || im.src.startsWith(location.origin)), 'External image URL')
      return { liveFetches: 0, imageSource: './placeholder.svg', csp: 'connect-src none' }
    })
  } finally {
    for (const [key, value] of storage) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    results.status = results.failed ? 'failed' : 'passed'
    results.finishedAt = new Date().toISOString()
    report()
    window.scrollTo(0, 0)
  }
  return results
}
window.runPerformanceTests = runPerformanceTests
window.performanceTestResults = { status: 'ready' }
document.getElementById('run').addEventListener('click', () => { void runPerformanceTests() })
// Expose the original only for inspection; tests never call it.
window.performanceHarness = { components, fixture, originalFetch, mount, select, snapshot }
