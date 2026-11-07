import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const locales = ['', '.zh', '.zh-Hant', '.ja', '.ko', '.fr', '.es']
const localePattern = /\.(?:zh-Hant|zh|ja|ko|fr|es)\.md$/
const files = [...new Set(execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md',
], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort()
const publishedFiles = new Set(execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '-z',
], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))
const documents = new Map()
const families = new Map()
const problems = []
let linkCount = 0

function parseFences(text) {
  const prose = []
  const blocks = []
  let active
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (active) {
      if (fence && fence[1][0] === active[0] && fence[1].length >= active.length && !fence[2].trim()) active = undefined
    } else if (fence) {
      active = fence[1]
      blocks.push(fence[2].trim())
    } else prose.push(line)
  }
  return { prose: prose.join('\n'), blocks, unclosed: Boolean(active) }
}

function withoutCode(text) {
  return parseFences(text).prose
}

function anchors(text) {
  const result = new Set()
  const used = new Set()
  for (const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g, '').replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
    let unique = slug
    for (let count = 1; used.has(unique); count++) unique = `${slug}-${count}`
    used.add(unique)
    result.add(unique)
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1])
  return result
}

function links(text) {
  const body = withoutCode(text)
  const result = []
  for (const match of body.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
    result.push(match[1] || match[2])
  }
  for (const match of body.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) result.push(match[1])
  for (const match of body.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    result.push(match[1] || match[2])
  }
  return result
}

for (const file of files) {
  const fullPath = path.resolve(root, file)
  const text = (await readFile(fullPath, 'utf8')).replaceAll('\r\n', '\n')
  if (parseFences(text).unclosed) problems.push(`${file}: unclosed code fence`)
  const document = { text, anchors: anchors(text), links: links(text) }
  documents.set(fullPath, document)
  const base = file.replace(localePattern, '.md')
  if (!families.has(base)) families.set(base, [])
  families.get(base).push(file)
}

for (const [base, members] of families) {
  const expected = locales.map((suffix) => base.replace(/\.md$/, `${suffix}.md`))
  for (const file of expected) {
    if (!members.includes(file)) problems.push(`${base}: missing translation ${file}`)
  }
  for (const file of members) {
    const document = documents.get(path.resolve(root, file))
    const navigation = new Set(document.text.split(/\r?\n/).slice(0, 5)
      .flatMap((line) => links(line)).map((link) => path.resolve(root, path.dirname(file), link)))
    for (const sibling of expected) {
      if (!navigation.has(path.resolve(root, sibling))) problems.push(`${file}: missing language link to ${sibling}`)
    }
  }
  const source = documents.get(path.resolve(root, base))
  if (!source) continue
  const structure = (document) => [...withoutCode(document.text).matchAll(/^(#{1,6})\s/gm)].map((m) => m[1]).join(',')
  const codeBlocks = (document) => JSON.stringify(parseFences(document.text).blocks)
  for (const file of members) {
    const document = documents.get(path.resolve(root, file))
    if (structure(document) !== structure(source)) problems.push(`${file}: heading structure differs from ${base}`)
    if (codeBlocks(document) !== codeBlocks(source)) problems.push(`${file}: code example languages/count differ from ${base}`)
  }
}

for (const [fullPath, document] of documents) {
  const file = path.relative(root, fullPath).replaceAll(path.sep, '/')
  for (const link of document.links) {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link)) continue
    linkCount++
    let decoded
    try { decoded = decodeURIComponent(link) }
    catch { problems.push(`${file}: invalid link encoding ${link}`); continue }
    const [target, fragment] = decoded.split('#', 2)
    const targetPath = target.split('?', 1)[0]
    const resolved = targetPath ? path.resolve(path.dirname(fullPath), targetPath) : fullPath
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      problems.push(`${file}: local link leaves repository ${link}`)
      continue
    }
    const exists = await stat(resolved).catch(() => null)
    if (!exists) { problems.push(`${file}: missing local target ${link}`); continue }
    // A link should remain valid in a fresh clone, not depend on ignored files.
    const relative = path.relative(root, resolved).replaceAll(path.sep, '/')
    if (exists.isFile() && !publishedFiles.has(relative)) problems.push(`${file}: local target is not publishable ${link}`)
    if (fragment && resolved.endsWith('.md')) {
      const targetDocument = documents.get(resolved)
      if (!targetDocument?.anchors.has(fragment)) problems.push(`${file}: missing heading anchor ${link}`)
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`Documentation check failed: ${problems.length} issue(s).`)
  process.exitCode = 1
} else {
  console.log(`Documentation checks passed: ${families.size} families, ${files.length} documents, 7 languages, ${linkCount} local links.`)
}
