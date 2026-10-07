/**
 * Sets a new password for an existing admin (lost password, locked-out tenant) and forces a change at next login.
 *
 *   npm run reset-admin -- --env staging --email admin@acme.test --password '<temporary password>'
 *   npm run reset-admin -- --env prod --confirm-production --email ... --password ...
 *
 * Password from --password or RESET_ADMIN_PASSWORD. Existing sessions are revoked. Writes an audit entry. Only works
 * on users that are admins in Firestore (it will not touch any other role).
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loopback, resolveTarget, type Firebaserc, type Target } from './envTarget.ts'

const { values } = parseArgs({
  options: { env: { type: 'string' }, 'confirm-production': { type: 'boolean', default: false }, email: { type: 'string' }, password: { type: 'string' } },
})
const die = (msg: string): never => {
  console.error(`reset-admin: ${msg}`)
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
const email = (values.email ?? '').trim().toLowerCase()
const password = values.password ?? process.env.RESET_ADMIN_PASSWORD ?? ''
if (!email) die('--email is required')
if (password.length < 8) die('password (min 8 chars) required (--password or RESET_ADMIN_PASSWORD)')

if (target.env === 'emulator') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
  if (!loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !loopback(process.env.FIRESTORE_EMULATOR_HOST)) die('emulator hosts must be loopback addresses')
} else {
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST
  delete process.env.FIRESTORE_EMULATOR_HOST
}
initializeApp({ projectId: target.projectId ?? rc.projects?.default ?? 'demo-conveypass' })

async function main(): Promise<void> {
  const auth = getAuth()
  const db = getFirestore()
  const user = await auth.getUserByEmail(email).catch(() => null)
  if (!user) die(`no Auth user with ${email}`)
  const uid = (user as NonNullable<typeof user>).uid
  const doc = await db.doc(`users/${uid}`).get()
  const data = doc.data() as { role?: string; tenantId?: string } | undefined
  if (!data || data.role !== 'admin') die('that user is not an admin: use the app (Users > Reset credential) for other roles')
  await auth.updateUser(uid, { password, disabled: false })
  await auth.revokeRefreshTokens(uid)
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, status: 'active', updatedAt: FieldValue.serverTimestamp() })
  await db.collection('auditLog').doc().create({
    tenantId: data?.tenantId ?? '', action: 'user.resetCredential', actorUid: 'reset-admin', actorRole: 'system', targetType: 'user', targetId: uid,
    meta: { env: target.env }, createdAt: FieldValue.serverTimestamp(),
  })
  console.log(`reset-admin: ${target.env}: password reset for ${email}; they must change it at next login`)
}
main().catch((e: unknown) => {
  console.error('reset-admin failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
