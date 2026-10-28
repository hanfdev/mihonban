import assert from 'node:assert/strict'
import test from 'node:test'

import { needsAdminElevation, sessionAfterLogout } from '../src/session.js'

test('a signed-in visitor needs admin elevation on the direct admin route', () => {
  assert.equal(needsAdminElevation({ view: 'admin' }, 'user'), true)
  assert.equal(needsAdminElevation({ view: 'admin' }, null), true)
  assert.equal(needsAdminElevation({ view: 'admin' }, 'admin'), false)
  assert.equal(needsAdminElevation({ view: 'library' }, 'user'), false)
})

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
