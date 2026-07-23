export function fmtDur(value) {
  if (value == null) return '–:––'
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
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
