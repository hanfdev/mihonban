export const RYM_RATING_PRIOR = 3.3
export const RYM_RATING_PRIOR_VOTES = 50

function finiteRating(value) {
  if (value == null || value === '') return null
  const rating = Number(value)
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null
}

function finiteVotes(value) {
  const votes = Number(value)
  return Number.isFinite(votes) && votes > 0 ? votes : 0
}

/**
 * Confidence-adjust a displayed RYM average without replacing the source data.
 * Fifty ratings give an above-prior score and the stable site-wide prior equal
 * weight. Scores at or below the prior are never lifted by uncertainty.
 */
export function weightedRymRating(rym) {
  const rating = finiteRating(rym?.rating)
  if (rating == null) return Number.NEGATIVE_INFINITY
  if (rating <= RYM_RATING_PRIOR) return rating
  const votes = finiteVotes(rym?.votes)
  return ((rating * votes) + (RYM_RATING_PRIOR * RYM_RATING_PRIOR_VOTES))
    / (votes + RYM_RATING_PRIOR_VOTES)
}

export function compareWeightedRym(a, b) {
  const weighted = weightedRymRating(b?.rym) - weightedRymRating(a?.rym)
  if (weighted) return weighted
  const votes = finiteVotes(b?.rym?.votes) - finiteVotes(a?.rym?.votes)
  if (votes) return votes
  return (finiteRating(b?.rym?.rating) ?? -1)
    - (finiteRating(a?.rym?.rating) ?? -1)
}

export function compareRawRym(a, b) {
  const rating = (finiteRating(b?.rym?.rating) ?? -1)
    - (finiteRating(a?.rym?.rating) ?? -1)
  if (rating) return rating
  return finiteVotes(b?.rym?.votes) - finiteVotes(a?.rym?.votes)
}

export function compactRatingVotes(value, locale = 'en') {
  const votes = finiteVotes(value)
  if (!votes) return ''
  try {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 0,
    }).format(votes)
  } catch {
    return String(Math.round(votes))
  }
}
