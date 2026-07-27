import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/Player.jsx', import.meta.url), 'utf8')
const start = source.indexOf('<div className="p-mini-ctrl">')
const end = source.indexOf('</div>', start)
const miniControls = source.slice(start, end)

test('mobile mini player exposes previous, play/pause and next in order', () => {
  const previous = miniControls.indexOf("__('player.prev')")
  const toggle = miniControls.indexOf('onClick={onToggle}')
  const next = miniControls.indexOf("__('player.next')")

  assert.ok(start >= 0, 'mini-player control group is present')
  assert.ok(previous >= 0, 'previous-track control is present')
  assert.ok(toggle > previous, 'play/pause follows previous track')
  assert.ok(next > toggle, 'next track follows play/pause')
  assert.match(miniControls, /onClick=\{\(\) => onStep\(-1\)\}/)
  assert.match(miniControls, /onClick=\{\(\) => onStep\(1\)\}/)
})
