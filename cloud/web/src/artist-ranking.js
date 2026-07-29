import { jaCollator } from './format.js'

export function compareArtistActivity(a, b) {
  return b.count - a.count
    || b.trackCount - a.trackCount
    || jaCollator.compare(a.sort, b.sort)
}
