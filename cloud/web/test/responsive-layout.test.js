import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const library = readFileSync(new URL('../src/views/Library.jsx', import.meta.url), 'utf8')

test('desktop search uses equal side tracks for viewport centering', () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)[^;]+minmax\(0, 1fr\);/)
})

test('tablet and constrained desktop headers use the compact search action', () => {
  assert.match(styles, /@media \(max-width: 1760px\) \{[\s\S]+?\.hdr-center \{ display: none; \}/)
  assert.match(styles, /@media \(max-width: 1760px\) \{[\s\S]+?\.m-search \{ display: grid;/)
})

test('tablet library sorting stays outside the scrollable filter group', () => {
  const mainStart = library.indexOf('<div className="library-filter-main">')
  const mainEnd = library.indexOf('</div>', mainStart)
  const tailStart = library.indexOf('<div className="filter-tail">', mainStart)

  assert.ok(mainStart >= 0)
  assert.ok(mainEnd > mainStart)
  assert.ok(tailStart > mainEnd)
  assert.match(styles, /@media \(min-width: 721px\) and \(max-width: 1280px\)[\s\S]+?\.library-filter-main \{[\s\S]+?overflow-x: auto;/)
})

test('descriptor actions do not overlay clamped text at any width', () => {
  assert.match(styles, /\.descriptor-summary\.has-overflow:not\(\.expanded\) \{ padding-right: 0; \}/)
  assert.match(styles, /\.descriptor-more \{[\s\S]+?position: static;[\s\S]+?margin: 5px 0 0 auto;/)
})

test('the mobile crop dialog keeps a centered overlay', () => {
  assert.match(styles, /\.crop-overlay \{ align-items: center; \}/)
})
