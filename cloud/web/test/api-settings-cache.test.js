import assert from 'node:assert/strict'
import test from 'node:test'

import { api, streamUrl } from '../src/api.js'

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
})

test('audio stream URLs opt into the same-origin proxy without duplicate query text', () => {
  assert.equal(streamUrl('track 1'), '/api/stream/track 1')
  assert.equal(streamUrl('track 1', { proxy: true }), '/api/stream/track 1?proxy=1')
})

test('config import invalidates the shared admin settings cache', async () => {
  const originalFetch = globalThis.fetch
  let version = 1
  let settingsReads = 0
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/admin/settings' && (init.method || 'GET') === 'GET') {
      settingsReads += 1
      return jsonResponse({ version })
    }
    if (url === '/api/admin/config/import' && init.method === 'POST') {
      version = 2
      return jsonResponse({ ok: true })
    }
    throw new Error(`unexpected request: ${init.method || 'GET'} ${url}`)
  }

  try {
    assert.deepEqual(await api.getSettingsShared(), { version: 1 })
    assert.deepEqual(await api.getSettingsShared(), { version: 1 })
    assert.equal(settingsReads, 1, 'settings reads should be shared before import')

    await api.importConfig({ settings: { guest_open: '1' } })

    assert.deepEqual(await api.getSettingsShared(), { version: 2 })
    assert.equal(settingsReads, 2, 'settings should be fetched again after import')
  } finally {
    globalThis.fetch = originalFetch
  }
})
