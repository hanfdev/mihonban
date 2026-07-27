// Lightweight i18n — no external deps.
// Language names always appear in their own script (English, 简体中文, …).
// Prefer calm, clear phrasing over slang; keep Japanese product voice where branded.

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { en } from './locales/en.js'

export const LANGS = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ja', label: '日本語', short: 'JP' },
  { id: 'ko', label: '한국어', short: 'KR' },
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'es', label: 'Español', short: 'ES' },
  { id: 'zh-Hans', label: '简体中文', short: '简' },
  { id: 'zh-Hant', label: '繁體中文', short: '繁' },
]

/** Map a BCP-47 tag (or prefix) to one of our locale ids, or null. */
function matchLocale(tag) {
  if (!tag) return null
  const t = String(tag).toLowerCase().replace('_', '-')
  // Chinese: region / script decide Hans vs Hant
  if (t === 'zh' || t.startsWith('zh-')) {
    if (/(^|-)(hant|tw|hk|mo)(-|$)/.test(t)) return 'zh-Hant'
    // zh-CN, zh-SG, zh-Hans, bare zh → simplified
    return 'zh-Hans'
  }
  if (t === 'ja' || t.startsWith('ja-')) return 'ja'
  if (t === 'ko' || t.startsWith('ko-')) return 'ko'
  if (t === 'fr' || t.startsWith('fr-')) return 'fr'
  if (t === 'es' || t.startsWith('es-')) return 'es'
  if (t === 'en' || t.startsWith('en-')) return 'en'
  return null
}

/** Resolve UI locale from browser/OS preference list. */
export function detectBrowserLang() {
  let list = []
  try {
    if (Array.isArray(navigator.languages) && navigator.languages.length) {
      list = [...navigator.languages]
    }
  } catch { /* ignore */ }
  try {
    if (navigator.language) list.push(navigator.language)
  } catch { /* ignore */ }
  try {
    const ui = navigator.userLanguage || navigator.browserLanguage
    if (ui) list.push(ui)
  } catch { /* ignore */ }
  for (const tag of list) {
    const id = matchLocale(tag)
    if (id) return id
  }
  return 'en'
}

// First visit / cleared storage → browser language.
// After the user picks a language, that choice sticks in localStorage.
const detect = () => {
  try {
    const saved = localStorage.getItem('mihonban_language')
    // Ignore legacy "system" sentinel from older builds
    if (saved && saved !== 'system' && LANGS.some((l) => l.id === saved)) return saved
  } catch { /* private mode */ }
  return detectBrowserLang()
}

// en 常驻主包兜底；其余语言按需异步加载（一个访客只用一种语言，
// 没必要让所有人下载 7 套字典 + 6 套后台翻译）。
const DICTS = { en }

const LOADERS = {
  'zh-Hans': () => import('./locales/zh-Hans.js'),
  'zh-Hant': () => import('./locales/zh-Hant.js'),
  ja: () => import('./locales/ja.js'),
  ko: () => import('./locales/ko.js'),
  fr: () => import('./locales/fr.js'),
  es: () => import('./locales/es.js'),
}

// 首屏语言包通常数百毫秒内完成。若浏览器/代理让 chunk 请求永久 pending，
// 8 秒后先用英文兜底开放界面；原请求随后成功时仍会切回目标语言。
export const LOCALE_BOOT_TIMEOUT_MS = 8000

/** 确保语言包就绪；en 或未知语言立即返回。返回是否加载成功（失败不抛出，回退英文）。 */
export async function loadLocale(lang) {
  if (DICTS[lang] || !LOADERS[lang]) return true
  try {
    DICTS[lang] = (await LOADERS[lang]()).default
    return true
  } catch {
    // 网络失败/陈旧 chunk 404：不缓存失败态，下次切回该语言会重试；
    // 调用方据返回值决定继续（此刻先用英文兜底渲染，绝不白屏）。
    return false
  }
}

function resolve(dict, path) {
  const parts = path.split('.')
  let cur = dict
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

export function translate(lang, key, ...args) {
  const dict = DICTS[lang] || en
  let v = resolve(dict, key)
  if (v === undefined) v = resolve(en, key)
  if (typeof v === 'function') return v(...args)
  return v ?? key
}

const I18nCtx = createContext({ lang: 'en', t: (k) => k, setLang: () => {} })

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detect)
  // 语言包异步到位后 +1，驱动 t 换新引用、消费者重渲染
  const [dictVersion, setDictVersion] = useState(0)
  const ready = !!DICTS[lang] || !LOADERS[lang]
  // 首屏（尚未渲染过任何内容）等待检测到的语言就绪，避免英文闪现；
  // booted 之后切换语言绝不卸载子树（播放器状态必须存活）。
  const [booted, setBooted] = useState(ready)

  // 静态 HTML 以英文作为脚本启动前的安全默认值；检测或用户切换语言后，
  // 同步真实 BCP-47 标签，让读屏、断字和浏览器翻译使用正确语言。
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (ready) { if (!booted) setBooted(true); return }
    let active = true
    const deadline = !booted
      ? setTimeout(() => { if (active) setBooted(true) }, LOCALE_BOOT_TIMEOUT_MS)
      : null
    // 加载尝试完成后无论成败都放开启动闸门：成功用目标语言，失败用英文兜底
    // （translate() 内置回退）。请求若永久 pending，上方 deadline 也会放开闸门。
    loadLocale(lang).then(() => {
      if (!active) return
      if (deadline !== null) clearTimeout(deadline)
      setDictVersion((n) => n + 1)
      setBooted(true)
    })
    return () => {
      active = false
      if (deadline !== null) clearTimeout(deadline)
    }
    // booted 只决定本次是否需要首屏 deadline；把它加入依赖会在超时后
    // 立即重复发起同一个 chunk 请求。切换语言由 lang 驱动，加载完成由 ready 驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, ready])

  const setLang = useCallback((id) => {
    if (!LANGS.some((l) => l.id === id)) return
    setLangState(id)
    try { localStorage.setItem('mihonban_language', id) } catch { /* ignore */ }
  }, [])

  const t = useCallback((key, ...args) => translate(lang, key, ...args),
    [lang, dictVersion])  // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({ lang, t, setLang, langs: LANGS }),
    [lang, t, setLang],
  )
  if (!booted && !ready) return null
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  return useContext(I18nCtx)
}

/** Compact language picker — short codes (EN / 简 / JP …) for mobile density. */
export function LangSelect({ className = '' }) {
  const { lang, setLang, langs, t } = useI18n()
  return (
    <select className={`lang-sel ${className}`} value={lang}
            aria-label={t('common.language')}
            title={langs.find((l) => l.id === lang)?.label || t('common.language')}
            onChange={(e) => setLang(e.target.value)}>
      {langs.map((l) => (
        <option key={l.id} value={l.id}>{l.short}</option>
      ))}
    </select>
  )
}
