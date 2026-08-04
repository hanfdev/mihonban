import assert from 'node:assert/strict'
import test from 'node:test'

import { contentLanguage } from '../src/content-language.js'

test('content language recognizes explicit CJK writing-system signals', () => {
  assert.equal(contentLanguage('天使音乐'), 'zh-Hans')
  assert.equal(contentLanguage('天使音樂'), 'zh-Hant')
  assert.equal(contentLanguage('天使の音楽'), 'ja')
  assert.equal(contentLanguage('천사의 음악'), 'ko')
})

test('ambiguous Han names retain the Japanese mincho voice', () => {
  assert.equal(contentLanguage('山下達郎'), 'ja')
  assert.equal(contentLanguage('王菲'), 'ja')
  assert.equal(contentLanguage('Fishmans'), 'en')
  assert.equal(contentLanguage(''), undefined)
})
