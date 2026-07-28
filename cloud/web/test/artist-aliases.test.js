import assert from 'node:assert/strict'
import test from 'node:test'

import { preferredArtistSort, romajiOf, sortOf, toJa } from '../src/aliases.js'
import { zhNorm } from '../src/zh.js'

const searchable = (artist, sort = '') =>
  zhNorm(`${artist} ${sort} ${romajiOf(artist)}`)

test('new Japanese artists match verified romanized aliases', () => {
  assert.equal(toJa('Ryusenkei'), '流線形')
  assert.equal(toJa('Hidemi Ishikawa'), '石川秀美')
  assert.equal(sortOf('流線形'), 'Ryusenkei')
  assert.equal(sortOf('石川秀美'), 'Ishikawa, Hidemi')
  assert.match(searchable('流線形'), /ryusenkei/)
  assert.match(searchable('石川秀美'), /ishikawa hidemi/)
})

test('catalog aliases include corrected spellings and verified identities', () => {
  assert.equal(toJa('MAMKO TAKADA'), '高田真樹子')
  assert.equal(toJa('Makiko Takada'), '高田真樹子')
  assert.equal(toJa('PINK PINCLES'), 'ピンク・ピクルス')
  assert.equal(toJa('Pink Pickles'), 'ピンク・ピクルス')
  assert.equal(toJa('YUKI KURODA'), '黒田有紀')
  assert.equal(toJa('TOSHITARO'), '稗島寿太郎')
  assert.equal(toJa('TOSHIO KUROSAWA & KAZUKO KANO'), '黒沢年男 & 叶和貴子')
  assert.equal(sortOf('中村容子'), 'Nakamura, Yoko')
})

test('Japanese traditional and simplified forms share the search key', () => {
  assert.ok(searchable('流線形').includes(zhNorm('流线形')))
  assert.ok(searchable('石川秀美').includes(zhNorm('石川秀美')))
})

test('artist sort remains searchable without a static alias', () => {
  assert.ok(searchable('未知藝人', 'Michi Geinin').includes('michi geinin'))
})

test('artist pages prefer saved metadata and fall back to verified aliases', () => {
  assert.equal(preferredArtistSort('流線形', '流線形'), 'Ryusenkei')
  assert.equal(preferredArtistSort('石川秀美'), 'Ishikawa, Hidemi')
  assert.equal(preferredArtistSort('流線形', 'RYUSENKEI'), 'RYUSENKEI')
  assert.equal(preferredArtistSort('未知藝人'), '')
})
