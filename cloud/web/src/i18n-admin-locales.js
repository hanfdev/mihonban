// Aggregator over the per-locale admin dictionaries in locales/.
// Only tests import this file; the app loads each locale lazily, so
// keeping this out of app imports keeps it out of the browser bundle.

import { admin as adminZhHans } from './locales/admin-zh-Hans.js'
import { admin as adminZhHant } from './locales/admin-zh-Hant.js'
import { admin as adminJa } from './locales/admin-ja.js'
import { admin as adminKo } from './locales/admin-ko.js'
import { admin as adminFr } from './locales/admin-fr.js'
import { admin as adminEs } from './locales/admin-es.js'

export const adminLocales = {
  'zh-Hans': adminZhHans,
  'zh-Hant': adminZhHant,
  ja: adminJa,
  ko: adminKo,
  fr: adminFr,
  es: adminEs,
}
