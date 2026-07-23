/**
 * 返回相邻曲目的队列位置；null 表示到达队尾且不循环。
 * 队首按上一首：列表循环时回到队尾，非循环时留在队首并重播。
 */
export function adjacentQueuePosition(pos, length, delta, repeat) {
  if (!Number.isInteger(pos) || length <= 0) return null
  const next = pos + delta
  if (next < 0) return repeat === 'all' ? length - 1 : 0
  if (next >= length) return repeat === 'all' ? 0 : null
  return next
}
