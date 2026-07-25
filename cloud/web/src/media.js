const positive = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function storedVolume(value, fallback = 1) {
  if (value === null || value === undefined || value === '') return fallback
  const volume = Number(value)
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback
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

/**
 * `audio.play()` fires `play` before remote audio has buffered enough to be
 * audible. Keep the system timeline frozen until `playing`; otherwise iOS
 * extrapolates a head start that can only be corrected after Safari wakes.
 */
export function mediaSessionPlaybackState(eventType, audioPaused,
                                          previousState = 'paused') {
  if (eventType === 'playing') return 'playing'
  if (['loadstart', 'waiting', 'stalled', 'pause', 'ended', 'emptied',
       'abort', 'error'].includes(eventType)) return 'paused'
  if (audioPaused) return 'paused'
  return previousState === 'playing' ? 'playing' : 'paused'
}

/** Load the selected source without starting its media clock. */
export function loadAudioUntilPlayable(audio, source, onPlayable) {
  if (!audio) return () => {}
  const ready = () => onPlayable?.()
  audio.addEventListener('canplay', ready, { once: true })
  audio.preload = 'auto'
  audio.src = source
  audio.load()
  return () => audio.removeEventListener('canplay', ready)
}
