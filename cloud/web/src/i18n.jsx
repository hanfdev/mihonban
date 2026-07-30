// Lightweight i18n — no external deps.
// Language names always appear in their own script (English, Simplified Chinese, etc.).
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

// English remains in the main bundle as the fallback. Load other languages on demand because each visitor
// uses only one, and everyone should not have to download all seven dictionaries and six admin translations.
const DICTS = { en }

const LOADERS = {
  'zh-Hans': () => import('./locales/zh-Hans.js'),
  'zh-Hant': () => import('./locales/zh-Hant.js'),
  ja: () => import('./locales/ja.js'),
  ko: () => import('./locales/ko.js'),
  fr: () => import('./locales/fr.js'),
  es: () => import('./locales/es.js'),
}

// The initial locale chunk normally arrives within a few hundred milliseconds. If a browser or proxy leaves
// the request pending indefinitely, open the interface in English after eight seconds and switch when it succeeds.
export const LOCALE_BOOT_TIMEOUT_MS = 8000

/** Ensure a locale bundle is ready. English and unknown locales return immediately; failures fall back without throwing. */
export async function loadLocale(lang) {
  if (DICTS[lang] || !LOADERS[lang]) return true
  try {
    DICTS[lang] = (await LOADERS[lang]()).default
    return true
  } catch {
    // Do not cache network failures or stale-chunk 404s, so selecting the locale again retries.
    // The caller can proceed in English for now; the interface must never remain blank.
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
  // Increment when an async locale arrives so t gets a new reference and consumers re-render.
  const [dictVersion, setDictVersion] = useState(0)
  const ready = !!DICTS[lang] || !LOADERS[lang]
  // Before first paint, wait for the detected locale to avoid an English flash.
  // After boot, changing language never unmounts the subtree because player state must survive.
  const [booted, setBooted] = useState(ready)

  // Static HTML uses English as a safe pre-script default. After detection or a user change, synchronize the real
  // BCP-47 tag so screen readers, line breaking, and browser translation use the correct language.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (ready) { if (!booted) setBooted(true); return }
    let active = true
    const deadline = !booted
      ? setTimeout(() => { if (active) setBooted(true) }, LOCALE_BOOT_TIMEOUT_MS)
      : null
    // Release the startup gate after the load attempt: use the target locale on success or English on failure
    // through translate()'s fallback. The deadline above also releases a permanently pending request.
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
    // booted only decides whether this run needs the first-paint deadline. Adding it as a dependency would immediately
    // repeat the same chunk request after timeout. lang drives locale changes; ready drives load completion.
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

/** Compact language picker using short codes for mobile density. */
export function LangSelect({ className = '' }) {
  const { lang, setLang, langs, t } = useI18n()
  return (
    <span className={`lang-wrap ${className}`}>
      <select className="lang-sel" value={lang}
              aria-label={t('common.language')}
              title={langs.find((l) => l.id === lang)?.label || t('common.language')}
              onChange={(e) => setLang(e.target.value)}>
        {langs.map((l) => (
          <option key={l.id} value={l.id}>{l.short}</option>
        ))}
      </select>
    </span>
  )
}
