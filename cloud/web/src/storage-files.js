export function storageName(t, storage) {
  return storage?.name?.trim() || t('storageFiles.unknownName')
}

export function storageDeletionText(t, storage, deleted = false) {
  const policy = storage?.kind === 'onedrive' ? 'Trash'
    : ['gdrive', 'local'].includes(storage?.kind) ? 'Permanent' : 'Unknown'
  return t(`storageFiles.${deleted ? 'deleted' : 'warning'}${policy}`, storageName(t, storage))
}
