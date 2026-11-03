import assert from 'node:assert/strict'
import test from 'node:test'

import { contentLanguage } from '../src/content-language.js'

test('content language recognizes explicit CJK writing-system signals', () => {
  assert.equal(contentLanguage('天使音乐'), 'zh-Hans')
  assert.equal(contentLanguage('天使音樂'), 'zh-Hant')
  assert.equal(contentLanguage('天使の音楽'), 'ja')
  assert.equal(contentLanguage('천사의 음악'), 'ko')
})

test('long mixed text follows its dominant script', () => {
  const zhReview = '凭借出道 EP《COOL》斩获2025年第22届韩国大众音乐奖“年度新人”、'
    + '并以《미친 건가（Crazy）》入围“最佳 R&B & Soul 歌曲”的周惠琳，从2022年的单曲《미장원》中精选出7首旧作'
  assert.equal(contentLanguage(zhReview), 'zh-Hans')
  assert.equal(contentLanguage('这张专辑收录了《天使の音楽》与《夜に駆ける》两首翻唱，时间跨度长达十年'), 'zh-Hans')
  assert.equal(contentLanguage('주혜린의 첫 번째 리메이크 앨범《Re-Make》는 2025年에 발매되었다'), 'ko')
  assert.equal(contentLanguage('山下達郎の名盤を聴く'), 'ja')
  assert.equal(contentLanguage('樂團的這張專輯收錄了《미장원》'), 'zh-Hant')
})

test('ambiguous Han names retain the Japanese mincho voice', () => {
  assert.equal(contentLanguage('山下達郎'), 'ja')
  assert.equal(contentLanguage('王菲'), 'ja')
  assert.equal(contentLanguage('Fishmans'), 'en')
  assert.equal(contentLanguage(''), undefined)
})
