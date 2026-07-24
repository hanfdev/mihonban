// System media surfaces have limited transport slots. Advertising both track
// navigation and ten-second seek actions can make iOS/Android hide prev/next.
const TRACK_ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']
const SUPPRESSED_ACTIONS = ['seekbackward', 'seekforward']

export function installTrackMediaSessionHandlers(session, handlers) {
  if (!session || typeof session.setActionHandler !== 'function') return () => {}

  const set = (action, handler) => {
    try { session.setActionHandler(action, handler) }
    catch { /* partial Media Session implementation */ }
  }

  // Keep seekto for the system progress slider, while reserving the adjacent
  // transport buttons for previous/next track.
  SUPPRESSED_ACTIONS.forEach((action) => set(action, null))
  TRACK_ACTIONS.forEach((action) => set(action, handlers[action] || null))

  return () => {
    ;[...TRACK_ACTIONS, ...SUPPRESSED_ACTIONS]
      .forEach((action) => set(action, null))
  }
}
