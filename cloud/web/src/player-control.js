export function playbackControlState(playing, buffering) {
  const active = Boolean(playing)
  return {
    action: active ? 'pause' : 'play',
    buffering: active && Boolean(buffering),
  }
}
