import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = readSource('../src/styles.css')

test('CJK content uses language-specific font stacks while the brand stays Japanese', () => {
  assert.match(styles, /--serif-ja:\s*"Shippori Mincho",\s*"GenRyu Mincho Fallback"/)
  assert.match(styles, /--serif-zh-hans:\s*"Shippori Mincho",\s*"GenRyu Mincho Fallback"/)
  assert.match(styles, /--serif-zh-hant:\s*"Shippori Mincho",\s*"GenRyu Mincho Fallback"/)
  assert.match(styles, /@font-face \{[\s\S]+?genryu-mincho-shippori-fallback\.woff2/)
  assert.match(styles, /--serif-zh-hans:[^;]*"Songti SC"/)
  assert.match(styles, /--serif-zh-hant:[^;]*"Songti TC"/)
  assert.match(styles, /--sans-zh-hans:[^;]*"PingFang SC"/)
  assert.match(styles, /--sans-zh-hant:[^;]*"PingFang TC"/)
  assert.match(styles, /\.logo \{[\s\S]+?font-family:\s*var\(--serif-ja\);/)
  assert.match(styles, /\.md \{ font-family:\s*var\(--serif\); \}/)
  assert.ok(statSync(new URL(
    '../public/fonts/genryu-mincho-shippori-fallback.woff2', import.meta.url)).size < 3_000_000)
  assert.ok(readFileSync(new URL(
    '../public/fonts/GenRyuMincho-OFL-1.1.txt', import.meta.url), 'utf8')
    .includes('SIL OPEN FONT LICENSE'))
})

test('primary library, artist, album, track, and player labels declare content language', () => {
  const sources = [
    '../src/views/Library.jsx',
    '../src/views/Artists.jsx',
    '../src/views/Artist.jsx',
    '../src/views/Album.jsx',
    '../src/views/Tracks.jsx',
    '../src/Player.jsx',
  ].map(readSource).join('\n')

  assert.match(sources, /lang=\{contentLanguage\(a\.title\)\}/)
  assert.match(sources, /lang=\{contentLanguage\(e\.name\)\}/)
  assert.match(sources, /lang=\{contentLanguage\(trackItem\.title\)\}/)
  assert.match(sources, /lang=\{contentLanguage\(t\.albumTitle\)\}/)
  assert.match(sources, /lang=\{contentLanguage\(current\.title\)\}/)
})
