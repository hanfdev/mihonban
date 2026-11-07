import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { encodeCapture, decodeCapture, receiveCapture, CAPTURE_KEY } from '../src/rym-capture.js'
import { needsAdminElevation } from '../src/session.js'
import { en } from '../src/locales/en.js'

const snapshot = { title: '音盤', artist: 'Artist', rating: 0, votes: 0, source: 'browser', observedAt: 1234,
  rymUrl: 'https://rateyourmusic.com/release/album/artist/record/', genres: ['Jazz'] }
test('browser transfer preserves Unicode and zero values and rejects malformed content', () => {
  assert.deepEqual(decodeCapture(encodeCapture(snapshot)), snapshot)
  for (const bad of [null, [], { ...snapshot, title: {} }, { ...snapshot, genres: [null] },
    { ...snapshot, rymUrl: 'javascript:alert(1)' }, { ...snapshot, rymUrl: 'https://rateyourmusic.com.evil.test/release/album/a/b/' },
    { ...snapshot, source: 'unknown' }]) assert.throws(() => decodeCapture(encodeCapture(bad)))
  assert.throws(() => decodeCapture('x'.repeat(100_001)))
  const unicode = { ...snapshot, genres: Array.from({ length: 200 }, (_, i) => '音'.repeat(70) + i) }
  assert.deepEqual(decodeCapture(encodeCapture(unicode)), unicode)
})

test('incoming fragments are removed before login and survive in session storage', t => {
  const originals = new Map(['location', 'history', 'sessionStorage'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  t.after(() => { for (const [k, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k] } })
  const stored = new Map(); let replacement
  globalThis.location = { hash: '#/rym/inbox/' + encodeCapture(snapshot), pathname: '/', search: '' }
  globalThis.history = { state: null, replaceState(_s, _t, path) { replacement = path } }
  globalThis.sessionStorage = { setItem(k, v) { stored.set(k, v) }, removeItem(k) { stored.delete(k) } }
  receiveCapture()
  assert.equal(replacement, '/#/rym'); assert.deepEqual(JSON.parse(stored.get(CAPTURE_KEY)), snapshot)
  assert.equal(needsAdminElevation({ view: 'rym' }, 'user'), true)
  assert.equal(needsAdminElevation({ view: 'rym' }, 'admin'), false)
  globalThis.sessionStorage = { setItem() { throw new Error('unavailable') }, removeItem() { throw new Error('unavailable') } }
  replacement = null
  receiveCapture()
  assert.equal(replacement, '/#/rym')
})

test('browser tool has no automatic content scripts, cookies or required hosts; batch access is optional and RYM-only', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../extensions/rym/manifest.json', import.meta.url)))
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage'])
  assert.deepEqual(manifest.optional_host_permissions, ['https://rateyourmusic.com/*', 'https://www.rateyourmusic.com/*'])
  for (const field of ['host_permissions', 'content_scripts', 'background', 'externally_connectable']) assert.equal(field in manifest, false)
})

test('all seven RYM workflows are complete and explicitly translated', async () => {
  for (const lang of ['zh-Hans', 'zh-Hant', 'ja', 'ko', 'fr', 'es']) {
    const { default: dict } = await import(`../src/locales/rym-${lang}.js`)
    const localeModule = await import(`../src/locales/${lang}.js`)
    const composed = Object.values(localeModule).find(value => value?.rymUpdate)
    assert.deepEqual(composed?.rymUpdate, dict, `${lang}: composed locale retains the translated workflow`)
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en.rymUpdate).sort())
    for (const [key, value] of Object.entries(dict)) {
      const actual = typeof value === 'function' ? value(1, 2, 3) : value
      const english = typeof en.rymUpdate[key] === 'function' ? en.rymUpdate[key](1, 2, 3) : en.rymUpdate[key]
      assert.ok(actual, `${lang}: ${key}`)
      // The word "suggestions" is shared by English and French.
      if (!(lang === 'fr' && key === 'suggestionCount')) assert.notEqual(actual, english, `${lang}: ${key}`)
    }
  }
})
