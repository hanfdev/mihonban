// Collator construction is expensive; localeCompare(x, 'ja') implicitly creates one for each comparison.
// Module-level singletons are roughly an order of magnitude faster while producing identical ordering.
export const jaCollator = new Intl.Collator('ja')
export const defaultCollator = new Intl.Collator()

export function fmtDur(value) {
  if (value == null) return '–:––'
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

export function fmtBitrate(value) {
  const bitrate = Number(value)
  if (!Number.isFinite(bitrate) || bitrate <= 0) return ''
  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(2).replace(/\.?0+$/, '')}M`
  }
  return `${Math.round(bitrate)}K`
}

/** Format total duration; pass t from useI18n when available. */
export function fmtTotal(value, t) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (t) {
    return hours
      ? t('time.hoursMinutes', hours, minutes)
      : t('time.minutes', minutes)
  }
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`
}
