const positive = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 曲库时长来自文件标签/解析器，比 Safari 对 OGG 流的动态估算稳定。
 * 只有曲库没有时长时，才采用浏览器报告的 duration。
 */
export function mediaDuration(knownDuration, nativeDuration) {
  return positive(knownDuration) || positive(nativeDuration)
}

export function clampMediaTime(value, duration) {
  const time = Number.isFinite(Number(value)) ? Math.max(Number(value), 0) : 0
  const total = positive(duration)
  return total ? Math.min(time, total) : time
}

export function seekAudio(audio, seconds, knownDuration, fast = false) {
  if (!audio) return 0
  const duration = mediaDuration(knownDuration, audio.duration)
  const target = clampMediaTime(seconds, duration)
  if (fast && typeof audio.fastSeek === 'function') audio.fastSeek(target)
  else audio.currentTime = target
  return target
}

/** 将可靠时长/进度主动同步给 iOS 锁屏和控制中心。 */
export function updateMediaPosition(session, audio, knownDuration) {
  if (!session || !audio || typeof session.setPositionState !== 'function') return false
  const duration = mediaDuration(knownDuration, audio.duration)
  if (!duration) return false
  const position = clampMediaTime(audio.currentTime, duration)
  const rate = positive(audio.playbackRate) || 1
  session.setPositionState({ duration, playbackRate: rate, position })
  return true
}
