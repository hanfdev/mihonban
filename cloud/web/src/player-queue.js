/**
 * Return the adjacent queue position; null means the boundary was reached without looping.
 * Previous at the first item wraps to the end in list-repeat mode, otherwise it stays and replays the first item.
 */
export function adjacentQueuePosition(pos, length, delta, repeat) {
  if (!Number.isInteger(pos) || length <= 0) return null
  const next = pos + delta
  if (next < 0) return repeat === 'all' ? length - 1 : 0
  if (next >= length) return repeat === 'all' ? 0 : null
  return next
}
