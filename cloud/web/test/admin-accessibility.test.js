import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/views/Admin.jsx', import.meta.url), 'utf8')

test('admin labels are associated and visible controls have accessible names', () => {
  for (const match of source.matchAll(/<label\b([^>]*)>/g)) {
    assert.match(match[1], /\bhtmlFor=/, `unassociated label: ${match[0]}`)
  }

  for (const match of source.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = match[2]
    if (/\bhidden\b/.test(attrs)) continue
    assert.match(
      attrs,
      /\b(?:id|aria-label)=/,
      `unnamed admin ${match[1]}: ${match[0]}`,
    )
  }

  for (const match of source.matchAll(/<button\b([^>]*)role="switch"([^>]*)>/g)) {
    assert.match(`${match[1]}${match[2]}`, /\baria-label=/)
  }
})
