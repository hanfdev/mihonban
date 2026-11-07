import assert from 'node:assert/strict'
import test from 'node:test'

import { albumAddedAt, compareRecentlyAdded } from '../src/album-added-time.js'

const idsByAdded = (albums) => [...albums].sort(compareRecentlyAdded).map((a) => a.id)

test('editing an old album preserves its position while new imports lead', () => {
  const old = { id: 'old', createdAt: 100, updatedAt: 100, title: 'Original', rym: { rating: 3 } }
  const newer = { id: 'newer', createdAt: 200, updatedAt: 200 }
  assert.deepEqual(idsByAdded([old, newer]), ['newer', 'old'])

  const edited = { ...old, updatedAt: 400, title: 'Renamed', rym: { rating: 5 } }
  assert.deepEqual(idsByAdded([edited, newer]), ['newer', 'old'])

  const imported = { id: 'imported', createdAt: 300, updatedAt: 300 }
  assert.deepEqual(idsByAdded([edited, imported, newer]), ['imported', 'newer', 'old'])
})

test('batch imports keep a stable order after edits and differently ordered refreshes', () => {
  const first = { id: 'a', createdAt: 100, updatedAt: 200, title: 'Z' }
  const second = { id: 'b', createdAt: 100, updatedAt: 100, title: 'A' }
  assert.deepEqual(idsByAdded([second, first]), ['a', 'b'])
  assert.deepEqual(idsByAdded([first, { ...second, updatedAt: 500, title: '0' }]), ['a', 'b'])
})

test('unknown or invalid added times stay last even with recent edits', () => {
  for (const createdAt of [undefined, null, '', 'invalid', NaN, Infinity, -Infinity, -1]) {
    const unknown = { id: 'unknown', createdAt, updatedAt: 1000 }
    const known = { id: 'known', createdAt: 100, updatedAt: 100 }
    assert.equal(albumAddedAt(unknown), 0)
    assert.deepEqual(idsByAdded([unknown, known]), ['known', 'unknown'])
  }
})
