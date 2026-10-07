/**
 * Creates a tenant and its first admin, in the emulator, staging or production.
 *
 *   npm run create-tenant -- --env emulator --tenant-name "Acme Quarry" --email admin@acme.test --password '...'
 *   npm run create-tenant -- --env staging  --tenant-name "Acme Quarry" --email ...
 *   npm run create-tenant -- --env prod --confirm-production --tenant-name "Acme Quarry" --email ...
 *
 * Credentials come from --email / --password or CREATE_TENANT_ADMIN_EMAIL / CREATE_TENANT_ADMIN_PASSWORD (never
 * hard-coded). Staging and production use Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * `gcloud auth application-default login`) and the project in `.firebaserc` (alias `staging` / `prod`).
 * The admin must change the password at first login (unless --keep-password).
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { newTenantId, provisionTenant } from '../functions/src/tenants/tenantDefaults.ts'
import { loopback, resolveTarget, type Firebaserc, type Target } from './envTarget.ts'

const { values } = parseArgs({
  options: {
    env: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    'tenant-name': { type: 'string' },
    'tenant-id': { type: 'string' },
    timezone: { type: 'string' },
    'keep-password': { type: 'boolean', default: false },
  },
})

const die = (msg: string): never => {
  console.error(`create-tenant: ${msg}`)
  process.exit(1)
}
const readJson = <T,>(path: string): T | Record<string, never> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return {}
  }
}

const target = ((): Target => {
  try {
    return resolveTarget({
    env: values.env,
    confirmProduction: values['confirm-production'],
    firebaserc: readJson<Firebaserc>('.firebaserc'),
    projectOverride: process.env.FIREBASE_PROJECT_ID,
  })
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e))
  }
})()

const email = (values.email ?? process.env.CREATE_TENANT_ADMIN_EMAIL ?? '').trim().toLowerCase()
const password = values.password ?? process.env.CREATE_TENANT_ADMIN_PASSWORD ?? ''
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('admin email required (--email or CREATE_TENANT_ADMIN_EMAIL)')
if (password.length < 8) die('admin password (min 8 chars) required (--password or CREATE_TENANT_ADMIN_PASSWORD)')
const timezone = values.timezone ?? 'Asia/Colombo'
try {
  new Intl.DateTimeFormat('en-US', { timeZone: timezone })
} catch {
  die(`unknown timezone "${timezone}" (use an IANA name such as Asia/Colombo)`)
}

const firebaseJson = readJson<{ emulators?: Record<string, { port?: number }> }>('firebase.json')
if (target.env === 'emulator') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
  process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
  if (!loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !loopback(process.env.FIRESTORE_EMULATOR_HOST)) die('emulator hosts must be loopback addresses')
} else {
  // A real project: make sure no leftover emulator variable redirects the writes.
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST
  delete process.env.FIRESTORE_EMULATOR_HOST
}

initializeApp({ projectId: target.projectId ?? (readJson<Firebaserc>('.firebaserc').projects?.default ?? 'demo-conveypass') })
const auth = getAuth()
const db = getFirestore()

async function main(): Promise<void> {
  const tenantName = values['tenant-name']?.trim()
  if (!tenantName) die('--tenant-name is required')
  // Default: `ten_` + 10 random chars, like tenants made by the setup link. --tenant-id still pins a readable id.
  const tenantId = values['tenant-id'] ?? newTenantId()

  if ((await db.doc(`tenants/${tenantId}`).get()).exists) die(`tenant "${tenantId}" already exists (use --tenant-id for another)`)
  if (await auth.getUserByEmail(email).catch(() => null)) die(`an Auth user with ${email} already exists`)

  const adminName = values.name ?? 'Admin'
  const user = await auth.createUser({ email, password, displayName: adminName })
  try {
    await auth.setCustomUserClaims(user.uid, { role: 'admin', tenantId })
    const batch = db.batch()
    // Defaults, the admin doc and the audit entries come from provisionTenant: the same code the setup link runs.
    provisionTenant(db, batch, {
      tenantId, tenantName: tenantName as string, timezone,
      admin: { uid: user.uid, name: adminName, email, mustChangePassword: !values['keep-password'], createdBy: 'create-tenant' },
      actor: { uid: 'create-tenant', role: 'system' }, meta: { env: target.env }, createdAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()
  } catch (e) {
    await auth.deleteUser(user.uid).catch(() => undefined)
    throw e
  }
  console.log(`create-tenant: ${target.env} ready. tenant="${tenantId}" admin=${email} uid=${user.uid}`)
  if (!values['keep-password']) console.log('create-tenant: the admin must change the password at first login')
}

main().catch((e: unknown) => {
  console.error('create-tenant failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
