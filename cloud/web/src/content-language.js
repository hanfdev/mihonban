const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const HANGUL = /\p{Script=Hangul}/gu
const HAN = /\p{Script=Han}/gu
const LATIN = /\p{Script=Latin}/u

// These characters distinguish Simplified Chinese from Japanese shinjitai and
// common shared Han forms without trying to identify every CJK string.
const SIMPLIFIED_CHINESE = /[乐这为发专录页们说让还关听写读见观个时间对过经样现实东长车门问无业]/g
const TRADITIONAL_CHINESE = /[樂這為發專錄頁們說讓還關聽寫讀裡]/g

const count = (text, pattern) => (text.match(pattern) || []).length

export function contentLanguage(value) {
  const text = String(value || '').trim()
  if (!text) return undefined
  const hangul = count(text, HANGUL)
  const kana = count(text, KANA)
  const han = count(text, HAN)
  // Decide by the dominant script, so a Chinese review that quotes a Korean or
  // Japanese title keeps the Chinese font stack for the whole paragraph.
  if (hangul && hangul >= han + kana) return 'ko'
  if (kana && kana * 4 >= han) return 'ja'
  const simplified = count(text, SIMPLIFIED_CHINESE)
  const traditional = count(text, TRADITIONAL_CHINESE)
  if (simplified && simplified >= traditional) return 'zh-Hans'
  if (traditional) return 'zh-Hant'
  if (hangul) return 'ko'
  // Ambiguous Han-only names stay in the product's Japanese mincho voice.
  if (han || kana) return 'ja'
  if (LATIN.test(text)) return 'en'
  return undefined
}
