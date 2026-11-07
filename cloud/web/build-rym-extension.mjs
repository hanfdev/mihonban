import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readRymPage } from './src/rym-capture.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, 'cloud/web/dist/rym-browser-tool')
await mkdir(output, { recursive: true })
for (const name of await readdir(resolve(root, 'extensions/rym'))) {
  await copyFile(resolve(root, 'extensions/rym', name), resolve(output, name))
}
await copyFile(resolve(root, 'cloud/web/src/rym-capture.js'), resolve(output, 'rym-capture.js'))
// Inject a self-contained reader; the result contains only rating fields.
await writeFile(resolve(output, 'batch-reader.js'), `(() => {
  const read = ${readRymPage.toString()};
  try {
    const text = (document.title + ' ' + (document.body?.innerText || '').slice(0, 2000));
    if (/too many requests|rate.?limit/i.test(text) || /^429(?: |$)/.test(document.title)) return { captureError: 'throttled' };
    if (/access denied|temporarily blocked|just a moment|captcha|attention required|403 forbidden/i.test(document.title)) return { captureError: 'challenge' };
    const snapshot = read();
    return Object.fromEntries(['title','artist','rymUrl','source','observedAt','rating','votes'].filter(key => key in snapshot).map(key => [key, snapshot[key]]));
  } catch (e) { return { captureError: e.message === 'challenge' ? 'challenge' : 'invalidPage' }; }
})();`)
// A small, deterministic stored ZIP needs no extra build dependencies.
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
const local = [], central = []
let offset = 0
for (const file of (await readdir(output)).sort()) {
  const name = Buffer.from(`rym-browser-tool/${file}`)
  const body = await readFile(resolve(output, file))
  const crc = crc32(body)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22)
  header.writeUInt16LE(name.length, 26)
  local.push(header, name, body)
  const directory = Buffer.alloc(46)
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6)
  directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16)
  directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24)
  directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42)
  central.push(directory, name)
  offset += header.length + name.length + body.length
}
const directory = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8)
end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
await writeFile(output + '.zip', Buffer.concat([...local, directory, end]))
console.log('Packaged RYM browser tool')
