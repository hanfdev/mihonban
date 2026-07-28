// 艺人别名库（romaji ↔ 原名）。数据源 artist-aliases.json —— 与管线/beets 共用同一份。
import DATA from './artist-aliases.json' with { type: 'json' }

const strip = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** 别名键归一：小写、去重音、折叠空白、×→x（与 pipeline 的 norm_alias_key 一致）。 */
export const normKey = (s) =>
  strip(String(s)).replace(/×/g, 'x').toLowerCase().split(/\s+/).join(' ').trim()

let M = null // normKey → entry|null
let R = null // 原名 → 该艺人全部罗马字键（搜索反查）
const build = () => {
  if (M) return
  M = new Map()
  R = new Map()
  for (const [k, v] of Object.entries(DATA.aliases || {})) {
    M.set(normKey(k), v)
    if (v?.name) R.set(v.name, [...(R.get(v.name) || []), k])
  }
}

/** 罗马字/英文名 → 日文原名；没有映射返回 null。自动兼容「姓 名」/「名 姓」词序。 */
export function toJa(name) {
  build()
  const k = normKey(name)
  let v = M.get(k)
  if (v === undefined) {
    const p = k.split(' ')
    if (p.length === 2) v = M.get(`${p[1]} ${p[0]}`)
  }
  return v?.name || null
}

/** 原名 → 该艺人已知的全部罗马字别名（拼进搜索 haystack，罗马字也能搜到）。 */
export function romajiOf(jaName) {
  build()
  return (R.get(jaName) || []).join(' ')
}

/** 原名 → 首选罗马字排序名；网页上传/编辑时一并持久化给后续搜索。 */
export function sortOf(jaName) {
  build()
  const keys = R.get(jaName) || []
  for (const key of keys) {
    const sort = M.get(normKey(key))?.sort
    if (typeof sort === 'string' && sort.trim()) return sort.trim()
  }
  return ''
}

/** Prefer catalog metadata, then fall back to the bundled verified alias. */
export function preferredArtistSort(name, stored = '') {
  const value = typeof stored === 'string' ? stored.trim() : ''
  if (value && value !== name) return value
  return sortOf(name)
}
