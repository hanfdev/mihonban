import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionAfterLogout } from '../src/session.js'

test('logout falls back to passwordless guest access when it is open', async () => {
  const calls = []
  const session = await sessionAfterLogout({
    async logout() { calls.push('logout') },
    async me() {
      calls.push('me')
      return { ok: true, role: 'user', guest: true }
    },
  })

  assert.deepEqual(calls, ['logout', 'me'])
  assert.deepEqual(session, { ok: true, role: 'user', guest: true })
})

test('logout returns a signed-out state when guest access is closed', async () => {
  const session = await sessionAfterLogout({
    async logout() {},
    async me() { return { ok: false, role: null, guest: false } },
  })

  assert.deepEqual(session, { ok: false, role: null, guest: false })
})

test('logout failure never keeps an assumed authenticated state', async () => {
  let checked = false
  const session = await sessionAfterLogout({
    async logout() { throw new Error('offline') },
    async me() { checked = true },
  })

  assert.equal(checked, false)
  assert.deepEqual(session, { ok: false, role: null, guest: false })
})
