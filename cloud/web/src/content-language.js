const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL = /\p{Script=Hangul}/u
const HAN = /\p{Script=Han}/u
const LATIN = /\p{Script=Latin}/u

// These characters distinguish Simplified Chinese from Japanese shinjitai and
// common shared Han forms without trying to identify every CJK string.
const SIMPLIFIED_CHINESE = /[乐这为发专录页们说让还关听写读见观]/
const TRADITIONAL_CHINESE = /[樂這為發專錄頁們說讓還關聽寫讀裡]/

export function contentLanguage(value) {
  const text = String(value || '').trim()
  if (!text) return undefined
  if (HANGUL.test(text)) return 'ko'
  if (KANA.test(text)) return 'ja'
  if (SIMPLIFIED_CHINESE.test(text)) return 'zh-Hans'
  if (TRADITIONAL_CHINESE.test(text)) return 'zh-Hant'
  // Ambiguous Han-only names stay in the product's Japanese mincho voice.
  if (HAN.test(text)) return 'ja'
  if (LATIN.test(text)) return 'en'
  return undefined
}
