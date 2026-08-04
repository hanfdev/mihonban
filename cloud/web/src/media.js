const positive = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function storedVolume(value, fallback = 1) {
  if (value === null || value === undefined || value === '') return fallback
  const volume = Number(value)
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback
}

export function volumeIconLevel(value) {
  const volume = storedVolume(value, 0)
  if (volume === 0) return 'muted'
  if (volume <= 1 / 3) return 'low'
  if (volume <= 2 / 3) return 'medium'
  return 'high'
}

/** Detect a home-screen or otherwise installed standalone web app. */
export function isStandaloneWebApp(browserWindow = globalThis.window,
                                   browserNavigator = globalThis.navigator) {
  if (browserNavigator?.standalone === true) return true
  try {
    return browserWindow?.matchMedia?.('(display-mode: standalone)')?.matches === true
  } catch {
    return false
  }
}

/** Detect iPhone, iPad, and iPadOS browsers that advertise a desktop platform. */
export function isIOSDevice(browserNavigator = globalThis.navigator) {
  const platform = String(browserNavigator?.platform || '')
  const userAgent = String(browserNavigator?.userAgent || '')
  return /iPhone|iPad|iPod/.test(`${platform} ${userAgent}`)
    || (/Mac/.test(platform) && Number(browserNavigator?.maxTouchPoints) > 1)
}

/** Keep installed iOS web apps on their native playback path. */
export function shouldDeferLockScreenPlayback(
  browserWindow = globalThis.window,
  browserNavigator = globalThis.navigator,
) {
  return isIOSDevice(browserNavigator)
    && !isStandaloneWebApp(browserWindow, browserNavigator)
}

/** Pause a silent iOS browser clock only when playback stalls in the background. */
export function shouldPauseForBackgroundBuffering(
  eligible, visibilityState, audioPaused, audioEnded, systemSeekPending = false,
) {
  return !!eligible && visibilityState === 'hidden'
    && !audioPaused && !audioEnded && !systemSeekPending
}

/**
 * Catalog duration comes from file tags or parsers and is more stable than Safari's evolving OGG stream estimate.
 * Use the browser-reported duration only when the catalog has no valid value.
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

/** Push reliable duration and progress to the iOS lock screen and Control Center. */
export function updateMediaPosition(session, audio, knownDuration,
                                    knownPosition = undefined) {
  if (!session || !audio || typeof session.setPositionState !== 'function') return false
  const duration = mediaDuration(knownDuration, audio.duration)
  if (!duration) return false
  const position = clampMediaTime(
    knownPosition === undefined ? audio.currentTime : knownPosition,
    duration,
  )
  const rate = positive(audio.playbackRate) || 1
  session.setPositionState({ duration, playbackRate: rate, position })
  return true
}

/** Hold a lock-screen seek target until the media element reaches it. */
export function resolvePendingMediaSeek(
  pending, sourceId, currentTime, seeking, now = Date.now(),
) {
  if (!pending || pending.sourceId !== sourceId) {
    return { pending: null, position: undefined }
  }
  const current = Math.max(Number(currentTime) || 0, 0)
  const reached = !seeking && Math.abs(current - pending.target) <= 1.5
  const expired = now - pending.requestedAt >= 15_000
  if (reached || expired) {
    return { pending: null, position: undefined }
  }
  return { pending, position: pending.target }
}

/** Freeze the lock-screen timeline before replacing the active media source. */
export function freezeMediaSession(session) {
  if (!session) return false
  try {
    session.playbackState = 'paused'
    if (typeof session.setPositionState === 'function') session.setPositionState()
    return true
  } catch {
    return false
  }
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

/** Load a selected source without starting its native media clock. */
export function loadAudioUntilPlayable(audio, source, onPlayable) {
  if (!audio) return () => {}
  let active = true
  const ready = () => {
    if (!active) return
    active = false
    audio.removeEventListener('canplay', ready)
    onPlayable?.()
  }
  audio.addEventListener('canplay', ready)
  audio.preload = 'auto'
  audio.src = source
  audio.load()
  return () => {
    active = false
    audio.removeEventListener('canplay', ready)
  }
}
