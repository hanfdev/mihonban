import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = path.join(root, 'cloud/web/src')
const target = path.join(root, 'ios/Resources')
const aliases = JSON.parse(fs.readFileSync(path.join(source, 'artist-aliases.json'), 'utf8'))
const normalization = fs.readFileSync(path.join(source, 'zh.js'), 'utf8')
const from = JSON.parse(normalization.match(/^const FROM = (".*")$/m)[1])
const to = JSON.parse(normalization.match(/^const TO = (".*")$/m)[1])
if ([...from].length !== [...to].length) throw new Error('Search character map length mismatch')
fs.writeFileSync(path.join(target, 'ArtistAliases.json'), JSON.stringify({ aliases: aliases.aliases }) + '\n')
fs.writeFileSync(path.join(target, 'SearchCharacters.json'), JSON.stringify({ from, to }) + '\n')
console.log(`Exported ${Object.keys(aliases.aliases).length} aliases and ${[...from].length} search character mappings`)
