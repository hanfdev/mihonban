import assert from 'node:assert/strict'
import test from 'node:test'

import { en } from '../src/locales/en.js'
import es from '../src/locales/es.js'
import fr from '../src/locales/fr.js'
import ja from '../src/locales/ja.js'
import ko from '../src/locales/ko.js'
import zhHans from '../src/locales/zh-Hans.js'
import zhHant from '../src/locales/zh-Hant.js'

const locales = { es, fr, ja, ko, 'zh-Hans': zhHans, 'zh-Hant': zhHant }

function leafPaths(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child)
      ? leafPaths(child, path)
      : [path]
  })
}

function resolve(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value)
}

test('every locale resolves every English dictionary leaf', () => {
  const expected = leafPaths(en)
  for (const [id, locale] of Object.entries(locales)) {
    for (const path of expected) {
      assert.notEqual(resolve(locale, path), undefined, `${id} is missing ${path}`)
    }
  }
})

test('new accessibility and error strings are explicitly localized', () => {
  const keys = [
    ['common', 'loadFailed'],
    ['common', 'zoom'],
    ['common', 'fav'],
    ['common', 'unfav'],
    ['common', 'faved'],
    ['player', 'seek'],
    ['player', 'volume'],
    ['player', 'mute'],
    ['player', 'unmute'],
    ['gallery', 'noImage'],
  ]
  for (const [id, locale] of Object.entries(locales)) {
    for (const [section, key] of keys) {
      assert.equal(
        Object.hasOwn(locale[section], key),
        true,
        `${id} inherits English ${section}.${key} instead of localizing it`,
      )
      assert.equal(typeof locale[section][key], 'string')
      assert.notEqual(locale[section][key].trim(), '')
    }
  }
})

test('Discogs image results report imported and skipped counts in every locale', () => {
  for (const [id, locale] of Object.entries({ en, ...locales })) {
    const message = locale.discogsAlbum.images(2, false, 3)
    assert.match(message, /2/, `${id} omits the imported count`)
    assert.match(message, /3/, `${id} omits the skipped count`)
  }
})

test('disc headings are localized in every locale', () => {
  for (const [id, locale] of Object.entries({ en, ...locales })) {
    assert.equal(typeof locale.common.disc, 'function', `${id} has no disc formatter`)
    assert.match(locale.common.disc(2), /2/, `${id} disc formatter omits the disc number`)
  }
})

test('confidence-aware and raw rating sorts are explicit in every locale', () => {
  for (const [id, locale] of Object.entries({ en, ...locales })) {
    assert.equal(Object.hasOwn(locale.library, 'sortRating'), true,
      `${id} has no confidence-aware rating label`)
    assert.equal(Object.hasOwn(locale.library, 'sortRatingRaw'), true,
      `${id} has no raw rating label`)
    assert.notEqual(locale.library.sortRating, locale.library.sortRatingRaw,
      `${id} does not distinguish weighted and raw ratings`)
  }
})
