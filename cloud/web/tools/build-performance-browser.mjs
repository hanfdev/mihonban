import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// From the repository: node cloud/web/tools/build-performance-browser.mjs.
// See test/browser/README.md for serving and running the browser checks.
// This build never changes production sources, dependencies, or configuration.
const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '..')
const repo = path.resolve(web, '../..')
const source = path.join(web, 'src')
// This is the parent of the list memoization change, not a local backup.
const baselineRevision = '95eed448dd80ca49de0de2703d1db1f7e78e8e94'
const run = promisify(execFile)
const output = path.join(repo, 'backups/web-perf-browser')
const views = new Set(['Favorites.jsx', 'Artist.jsx', 'Library.jsx', 'Artists.jsx', 'Import.jsx'])
const manifest = { builtAt: new Date().toISOString(), baselineRevision, files: {} }
const hash = (text) => createHash('sha256').update(text).digest('hex')
const assertMarker = (text, marker) => {
  if (!text.includes(marker)) throw new Error(`Instrumentation marker changed: ${marker}`)
}
const readBaseline = async (filename) => {
  try {
    const { stdout } = await run('git', ['show', `${baselineRevision}:cloud/web/src/views/${path.basename(filename)}`],
      { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024 })
    return stdout
  } catch (error) {
    throw new Error(`Cannot read browser-test baseline ${baselineRevision}. Fetch the repository history before building the harness.`, { cause: error })
  }
}

const instrumentation = {
  name: 'actual-view-baselines-and-counters',
  setup(plugin) {
    plugin.onResolve({ filter: /^(baseline|current):/ }, ({ path: id }) => {
      const [variant, name] = id.split(':')
      if (!views.has(`${name}.jsx`)) throw new Error(`Unknown view ${name}`)
      return { path: path.join(source, 'views', `${name}.jsx`), namespace: variant }
    })
    plugin.onResolve({ filter: /^\./ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path)
      if (views.has(path.basename(resolved)) && path.dirname(resolved) === path.join(source, 'views')) {
        return { path: resolved, namespace: args.namespace === 'baseline' ? 'baseline' : 'current' }
      }
      return undefined
    })
    for (const variant of ['baseline', 'current']) {
      plugin.onLoad({ filter: /\.jsx$/, namespace: variant }, async ({ path: filename }) => {
        const original = variant === 'baseline'
          ? await readBaseline(filename) : await readFile(filename, 'utf8')
        manifest.files[`${variant}/${path.basename(filename)}`] = hash(original)
        // Count real comparator invocations, including inline numeric comparators.
        const contents = original.replaceAll('.sort(', '.__perfSort(')
        return { contents, loader: 'jsx', resolveDir: path.dirname(filename) }
      })
    }
    plugin.onLoad({ filter: /[\\/]Tracks\.jsx$/ }, async ({ path: filename }) => {
      const original = await readFile(filename, 'utf8')
      const marker = /function TrackRowInner\([\s\S]*?\) \{/
      if (!marker.test(original)) throw new Error('TrackRowInner instrumentation marker changed')
      return {
        contents: original.replace(marker, (text) => `${text}\n  globalThis.__perfRow(t.id)`),
        loader: 'jsx', resolveDir: path.dirname(filename),
      }
    })
    plugin.onLoad({ filter: /[\\/]zh\.js$/ }, async ({ path: filename }) => {
      const original = await readFile(filename, 'utf8')
      if (!original.includes('export function zhNorm(s) {')) throw new Error('zhNorm marker changed')
      return { contents: original.replace('export function zhNorm(s) {',
        'export function zhNorm(s) { globalThis.__perfNorm(s);'), loader: 'js' }
    })
    plugin.onLoad({ filter: /[\\/]api\.js$/ }, async ({ path: filename }) => {
      const original = await readFile(filename, 'utf8')
      // Keep the actual API client and request parsing; only image URLs are local fixtures.
      assertMarker(original, 'export const artUrl =')
      assertMarker(original, 'export const artistArtUrl =')
      return { contents: original
        .replace('export const artUrl =', 'const originalArtUrl =')
        .replace('export const artistArtUrl =', 'const originalArtistArtUrl =')
        + "\nexport const artUrl = () => './placeholder.svg';\nexport const artistArtUrl = () => './placeholder.svg';\n",
      loader: 'js', resolveDir: path.dirname(filename) }
    })
  },
}

await mkdir(output, { recursive: true })
await build({
  entryPoints: [path.join(web, 'test/browser/runner.jsx')], outfile: path.join(output, 'runner.js'),
  bundle: true, platform: 'browser', format: 'iife', sourcemap: true,
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [instrumentation],
  logLevel: 'info',
})
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
await writeFile(path.join(output, 'placeholder.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ddd"/></svg>')
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; font-src 'none'">
<title>Actual React list performance regressions</title>
<style>
body{font:14px system-ui;margin:20px;background:#fff;color:#222}button,select{font:inherit}
#report{white-space:pre-wrap;overflow-wrap:anywhere}#fixture{border:1px solid #aaa;padding:8px;max-width:900px}
#fixture img{width:16px;height:16px}#fixture svg{width:14px;height:14px}
#fixture .grid,#fixture .agrid{display:flex;flex-wrap:wrap;gap:8px}
#fixture .card,#fixture .acard{width:130px}#fixture .fav-trow,#fixture .trow{min-height:32px}
#fixture .trow{display:flex;align-items:center;gap:8px}#fixture .fav-grip{display:inline-block;padding:5px}
#fixture .filters{display:flex;flex-wrap:wrap;gap:8px}#fixture .t-main{min-width:150px}
#fixture .fav-trow{border-bottom:1px solid #ddd}.reordering{user-select:none}
.pass{color:#176436}.fail{color:#a11}details{margin-top:12px}
</style></head><body><h1>Actual React list performance regressions</h1>
<p>Baseline snapshots versus current source. No live API, no player, no mutation of production files.</p>
<button id="run">Run all tests</button> <span id="status">Ready</span>
<pre id="report"></pre><div id="fixture"></div><script src="./runner.js"></script></body></html>`)
console.log(`Built isolated browser harness: ${output}`)
console.log('Serve this directory with a static HTTP preview configuration; open index.html.')
console.log('Run window.runPerformanceTests(); inspect window.performanceTestResults or #report.')
