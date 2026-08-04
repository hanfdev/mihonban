export function addFavoriteToFront(items, id, timestamp) {
  const minimumOrder = items.reduce((minimum, item) =>
    Number.isFinite(item.order)
      ? (minimum === null ? item.order : Math.min(minimum, item.order))
      : minimum, null)
  return [{ id, ts: timestamp, order: minimumOrder === null ? 0 : minimumOrder - 1 },
    ...items]
}
