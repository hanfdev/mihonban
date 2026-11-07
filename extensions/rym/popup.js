import { readRymPage, encodeCapture } from './rym-capture.js'
import { messages } from './translations.js'
import { batchMessages } from './batch-translations.js'

const locale = navigator.language.toLowerCase()
const lang = locale.startsWith('zh') ? /tw|hk|hant/.test(locale) ? 'zh-Hant' : 'zh-Hans' : locale.split('-')[0]
const t = messages[lang] || messages.en
const batchText = batchMessages[lang] || batchMessages.en
document.querySelector('#batch').textContent = batchText.title
document.querySelector('#batch-hint').textContent = batchText.popupHint
document.documentElement.lang = lang
document.querySelector('#address-label').textContent = t.address
document.querySelector('#hint').textContent = t.hint
document.querySelector('#send').textContent = t.send
const address = document.querySelector('#address')
const status = document.querySelector('#status')
const saved = await chrome.storage.local.get('address')
address.value = saved.address || ''

document.querySelector('#batch').addEventListener('click', async () => {
  const button = document.querySelector('#batch'); button.disabled = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const page = new URL(tab.url)
    if (['rateyourmusic.com', 'www.rateyourmusic.com'].includes(page.hostname)) throw new Error('library')
    const [check] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      try { const response = await fetch('/api/admin/rym', { credentials: 'same-origin', redirect: 'error' }); return response.ok && Array.isArray(await response.json()) }
      catch { return false }
    } })
    if (!check?.result) throw new Error('library')
    const url = chrome.runtime.getURL('batch.html')
    const existing = (await chrome.tabs.query({ url: url + '*' }))[0]
    if (existing) {
      await chrome.runtime.sendMessage({ type: 'connectBatch', libraryTab: tab.id }).catch(() => {})
      await chrome.tabs.update(existing.id, { active: true })
    } else await chrome.tabs.create({ url: `${url}?libraryTab=${tab.id}` })
    window.close()
  } catch { status.textContent = batchText.library }
  finally { button.disabled = false }
})
document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault()
  const button = document.querySelector('#send')
  button.disabled = true; status.textContent = ''
  try {
    const destination = new URL(address.value)
    if (destination.username || destination.password || (destination.protocol !== 'https:'
      && !(destination.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname)))) throw new Error('address')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const page = new URL(tab.url)
    if (page.protocol !== 'https:' || !['rateyourmusic.com', 'www.rateyourmusic.com'].includes(page.hostname)) throw new Error('page')
    const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readRymPage })
    if (!capture?.result) throw new Error('page')
    await chrome.storage.local.set({ address: destination.origin })
    await chrome.tabs.create({ url: `${destination.origin}/#/rym/inbox/${encodeCapture(capture.result)}` })
    window.close()
  } catch (error) {
    status.textContent = error.message === 'address' ? t.invalidAddress : t.invalidPage
  } finally { button.disabled = false }
})
