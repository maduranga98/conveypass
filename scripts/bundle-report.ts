/**
 * Gzipped JS and CSS a phone downloads to open each route for the first time (the shell plus that route's chunks),
 * read from dist/.vite/manifest.json. Run after `npm run build`.
 *
 *   npm run bundle:report                 # prints a table
 *   npm run bundle:report -- --budget     # also fails when a budget below is exceeded (used in CI)
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { initialFiles, ROUTES, routeFiles, type Manifest } from './bundleReport.ts'

/**
 * Gzipped KB a phone downloads for the first visit: a regression guard set a little above today's size (Firebase's
 * Firestore, Auth and Functions SDKs, React and the router are most of it). Driver and security routes are phones on
 * mobile data: raise a number only on purpose.
 */
const BUDGET_KB: Record<string, number> = {
  'Driver home (/driver)': 300,
  'Driver pre-trip form (/v/:id)': 345,
  'Security gate (/security)': 310,
  'Security vehicle view (/v/:id)': 345,
}

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8')) as Manifest
const size = (file: string): number => gzipSync(readFileSync(`dist/${file}`)).length
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
const total = (files: Iterable<string>): number => [...files].reduce((sum, f) => sum + size(f), 0)

const shell = initialFiles(manifest, 'index.html')
console.log(`Shell (every route): ${kb(total(shell))} gzipped, ${shell.size} files\n`)
console.log('Route'.padEnd(42), 'gzip'.padStart(10), '  of which route-specific')
let failed = false
for (const spec of ROUTES) {
  const files = routeFiles(manifest, spec)
  const t = total(files)
  const budget = BUDGET_KB[spec.name]
  const over = budget !== undefined && t / 1024 > budget
  if (over) failed = true
  console.log(spec.name.padEnd(42), kb(t).padStart(10), `  +${kb(t - total(shell))}${budget !== undefined ? `  (budget ${budget} KB${over ? ': OVER' : ''})` : ''}`)
}
console.log('\nHeavy libraries load on demand only: exceljs (report export), recharts (charts), html5-qrcode (scanner).')
for (const [name, needle] of [['exceljs', 'exceljs'], ['recharts', 'CartesianChart'], ['html5-qrcode', 'QrScanner']] as const) {
  const inShell = [...shell].some((f) => f.includes(needle))
  console.log(`  ${name.padEnd(14)} in the shell: ${inShell ? 'YES (bad)' : 'no'}`)
  if (inShell) failed = true
}
if (process.argv.includes('--budget') && failed) {
  console.error('\nbundle-report: a budget was exceeded or a heavy library leaked into the shell')
  process.exit(1)
}
