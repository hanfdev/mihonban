import assert from 'node:assert/strict'
import test from 'node:test'

import { adminEn } from '../src/i18n-admin-en.js'
import { adminLocales } from '../src/i18n-admin-locales.js'

const translatedKeys = [
  'streamProxy', 'streamProxyDesc', 'streamProxyUrl', 'streamProxyUrlPh',
  'streamProxyUrlHint', 'proxyUrlSaved', 'configBackup', 'configBackupHint',
  'configExport', 'configImport', 'configExportOk', 'configImportConfirm',
  'configImportOk', 'configImportFail',
]

test('admin proxy and backup controls are translated in every non-English locale', () => {
  for (const [locale, messages] of Object.entries(adminLocales)) {
    for (const key of translatedKeys) {
      assert.equal(key in messages, true, `${locale} is missing admin.${key}`)
      assert.notEqual(
        String(messages[key]),
        String(adminEn[key]),
        `${locale} admin.${key} still falls back to English`,
      )
    }
  }
})
