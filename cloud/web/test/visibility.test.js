import assert from 'node:assert/strict'
import test from 'node:test'

import { visibleAlbumCount } from '../src/visibility.js'

const albums = [{ id: 'visible' }, { id: 'hidden', hidden: true }]

test('library count follows the administrator hidden-content toggle', () => {
  assert.equal(visibleAlbumCount(albums, { isAdmin: true, showHidden: false }), 1)
  assert.equal(visibleAlbumCount(albums, { isAdmin: true, showHidden: true }), 2)
})

test('listener count never includes hidden albums', () => {
  assert.equal(visibleAlbumCount(albums, { isAdmin: false, showHidden: true }), 1)
  assert.equal(visibleAlbumCount(null), null)
})
