/**
 * Counts documents per collection in a database and compares them (restore drill, docs/ops.md).
 *
 *   npm run verify-restore -- --env staging --database restore-drill            # compares with (default)
 *   npm run verify-restore -- --env staging --database restore-drill --tolerance 25
 *   npm run verify-restore -- --env emulator --expect .drill/counts.json        # against a saved snapshot
 *   npm run verify-restore -- --env emulator --save .drill/counts.json          # save the current counts
 *
 * Read only. Exits 1 when a collection differs by more than --tolerance (default 0).
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { loopback, resolveTarget, type Firebaserc, type Target } from './envTarget.ts'
import { COLLECTIONS, compareCounts, formatComparison, type Counts } from './restoreCheck.ts'

const { values } = parseArgs({
  options: {
    env: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
    database: { type: 'string' },
    against: { type: 'string', default: '(default)' },
    tolerance: { type: 'string', default: '0' },
    expect: { type: 'string' },
    save: { type: 'string' },
  },
})
const die = (msg: string): never => {
  console.error(`verify-restore: ${msg}`)
  process.exit(1)
}
const rc = ((): Firebaserc => {
  try {
    return JSON.parse(readFileSync('.firebaserc', 'utf8')) as Firebaserc
  } catch {
    return {}
  }
})()
const target = ((): Target => {
  try {
    return resolveTarget({ env: values.env, confirmProduction: values['confirm-production'], firebaserc: rc, projectOverride: process.env.FIREBASE_PROJECT_ID })
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e))
  }
})()
if (target.env === 'emulator') {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
  if (!loopback(process.env.FIRESTORE_EMULATOR_HOST)) die('emulator host must be loopback')
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST
}
const app = initializeApp({ projectId: target.projectId ?? process.env.GCLOUD_PROJECT ?? rc.projects?.default ?? 'demo-conveypass' })

async function count(databaseId: string): Promise<Counts> {
  const db = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId)
  const out: Counts = {}
  for (const c of COLLECTIONS) out[c] = (await db.collection(c).count().get()).data().count
  return out
}

async function main(): Promise<void> {
  const tolerance = Number(values.tolerance)
  if (!Number.isInteger(tolerance) || tolerance < 0) die('--tolerance must be a whole number')
  const database = values.database ?? '(default)'
  const actual = await count(database)
  if (values.save) {
    mkdirSync(dirname(values.save), { recursive: true })
    writeFileSync(values.save, JSON.stringify(actual, null, 2))
    console.log(`verify-restore: saved counts of ${database} to ${values.save}`)
    return
  }
  const expected: Counts = values.expect ? (JSON.parse(readFileSync(values.expect, 'utf8')) as Counts) : await count(values.against ?? '(default)')
  const result = compareCounts(expected, actual, tolerance)
  console.log(`verify-restore: ${database} (restored) against ${values.expect ?? values.against} (expected)\n`)
  console.log(formatComparison(result))
  console.log(result.ok ? '\nverify-restore: OK' : '\nverify-restore: MISMATCH (see above)')
  process.exit(result.ok ? 0 : 1)
}
main().catch((e: unknown) => {
  console.error('verify-restore failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
