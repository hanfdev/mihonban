import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const library = readFileSync(new URL('../src/views/Library.jsx', import.meta.url), 'utf8')
const tracks = readFileSync(new URL('../src/views/Tracks.jsx', import.meta.url), 'utf8')

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

test('volume sliders can shrink beside their icon without clipping endpoint thumbs', () => {
  assert.match(styles, /\.p-vol input\[type="range"\] \{[\s\S]+?flex:\s*1 1 0;[\s\S]+?min-width:\s*0;/)
  assert.match(styles, /\.np-vol input\[type="range"\] \{[\s\S]+?flex:\s*1 1 0;[\s\S]+?min-width:\s*0;/)
})

test('iOS track locating can disable deferred painting for the active list', () => {
  assert.match(styles, /\.flat-list\.track-locate-materialized \.trow\.flat \{[\s\S]+?content-visibility:\s*visible;/)
})

test('guest track rows do not reserve the absent favorite control', () => {
  assert.match(tracks, /className=\{`trow flat \$\{isAdmin \? 'with-heart' : ''\}/)
  assert.match(styles, /\.trow\.flat \{\s*grid-template-columns:\s*44px minmax\(0, 1\.4fr\) minmax\(0, 1fr\) 52px;/)
  assert.match(styles, /\.trow\.flat\.with-heart \{\s*grid-template-columns:\s*44px minmax\(0, 1\.4fr\) minmax\(0, 1fr\) 52px 34px;/)
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]+?\.trow\.flat \{ grid-template-columns: 44px minmax\(0, 1fr\) 46px; \}[\s\S]+?\.trow\.flat\.with-heart \{ grid-template-columns: 44px minmax\(0, 1fr\) 46px 34px; \}/)
})
