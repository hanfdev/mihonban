import assert from 'node:assert/strict'
import test from 'node:test'
import { storageName, storageDeletionText } from '../src/storage-files.js'

const t = (key, name) => ({ key, name })

test('file deletion messages follow the backend, not its display name', () => {
  for (const [kind, policy] of [
    ['onedrive', 'Trash'], ['gdrive', 'Permanent'], ['local', 'Permanent'],
    ['webdav', 'Unknown'], ['future-backend', 'Unknown'],
  ]) {
    const storage = { name: 'OneDrive-labelled NAS', kind }
    for (const deleted of [false, true]) {
      assert.deepEqual(storageDeletionText(t, storage, deleted), {
        key: `storageFiles.${deleted ? 'deleted' : 'warning'}${policy}`,
        name: storage.name,
      })
    }
  }
})

test('missing storage metadata uses a neutral fallback without a recovery promise', () => {
  const translate = (key, name) => name ? `${key}: ${name}` : 'Linked storage'
  for (const storage of [undefined, null, {}, { name: '  ' }]) {
    assert.equal(storageName(translate, storage), 'Linked storage')
    assert.equal(storageDeletionText(translate, storage),
      'storageFiles.warningUnknown: Linked storage')
    assert.equal(storageDeletionText(translate, storage, true),
      'storageFiles.deletedUnknown: Linked storage')
  }
  assert.equal(storageName(translate, { name: '  Music NAS  ' }), 'Music NAS')
})
