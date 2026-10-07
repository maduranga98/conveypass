/**
 * Bootstrap a tenant and its first admin.
 *
 *   npm run seed:emulator -- --email a@b.com --password '...' [--name "Admin"] [--tenant-name "Acme"]
 *   npm run seed:prod -- --confirm-production --email a@b.com --password '...'
 *
 * Credentials come from CLI args or SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (never hard-coded).
 * Emulator ports come from firebase.json (override with FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST).
 * Production uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS) and the project in
 * FIREBASE_PROJECT_ID or .firebaserc.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    'tenant-name': { type: 'string' },
    'tenant-id': { type: 'string' },
    'keep-password': { type: 'boolean', default: false },
  },
})

const die = (msg: string): never => {
  console.error(`seed: ${msg}`)
  process.exit(1)
}

const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const target = values.target ?? process.env.SEED_TARGET
if (target !== 'emulator' && target !== 'prod') die('--target must be "emulator" or "prod"')
if (target === 'prod' && !values['confirm-production']) {
  die('refusing to touch production without --confirm-production')
}

const email = (values.email ?? process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
const password = values.password ?? process.env.SEED_ADMIN_PASSWORD ?? ''
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('admin email required (--email or SEED_ADMIN_EMAIL)')
if (password.length < 8) die('admin password (min 8 chars) required (--password or SEED_ADMIN_PASSWORD)')

const firebaseJson = readJson('firebase.json') as { emulators?: Record<string, { port?: number }> }
const firebaserc = readJson('.firebaserc') as { projects?: { default?: string } }
const projectId = process.env.FIREBASE_PROJECT_ID ?? firebaserc.projects?.default
if (!projectId) die('project id not found (set FIREBASE_PROJECT_ID or .firebaserc)')

if (target === 'emulator') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
  process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
} else {
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST
  delete process.env.FIRESTORE_EMULATOR_HOST
}

initializeApp({ projectId })
const auth = getAuth()
const db = getFirestore()

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

async function main(): Promise<void> {
  const tenantName = values['tenant-name'] ?? 'ConvoyPass'
  const tenantId = values['tenant-id'] ?? (slug(tenantName) || 'default')

  const tenantRef = db.doc(`tenants/${tenantId}`)
  if ((await tenantRef.get()).exists) die(`tenant "${tenantId}" already exists (use --tenant-id for another)`)

  const existing = await auth.getUserByEmail(email).catch(() => null)
  if (existing) die(`an Auth user with ${email} already exists`)

  const user = await auth.createUser({ email, password, displayName: values.name ?? 'Admin' })
  try {
    await auth.setCustomUserClaims(user.uid, { role: 'admin', tenantId })
    const batch = db.batch()
    batch.create(tenantRef, { name: tenantName, status: 'active', createdAt: FieldValue.serverTimestamp() })
    batch.create(db.doc(`users/${user.uid}`), {
      tenantId,
      role: 'admin',
      contractorId: null,
      name: values.name ?? 'Admin',
      email,
      phone: null,
      status: 'active',
      mustChangePassword: !values['keep-password'],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'seed',
      updatedAt: FieldValue.serverTimestamp(),
    })
    batch.create(db.collection('auditLog').doc(), {
      tenantId,
      action: 'seed.createAdmin',
      actorUid: 'seed',
      actorRole: 'admin',
      targetType: 'user',
      targetId: user.uid,
      meta: { target },
      createdAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()
  } catch (e) {
    await auth.deleteUser(user.uid).catch(() => undefined)
    throw e
  }

  console.log(`seed: ${target} ready. tenant="${tenantId}" admin=${email} uid=${user.uid}`)
  if (!values['keep-password']) console.log('seed: admin must change the password on first login')
}

main().catch((e: unknown) => {
  console.error('seed failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
