/**
 * Proves that no client role can read or write `setupInvites`, against the emulators (Auth + Firestore with the real
 * rules). Uses a raw Admin SDK call to show the invite exists (so a denial is not just "not found"), then tries every
 * role and a signed-out visitor with the client SDK.
 *
 *   npx firebase emulators:exec --only auth,firestore --project demo-conveypass "npm run verify:invite-access"
 *
 * Exits 1 if anything is allowed. Emulator only.
 */
import { initializeApp as initAdmin } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore as getAdminDb, Timestamp } from 'firebase-admin/firestore'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, initializeFirestore, setDoc, setLogLevel, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { loopback } from './envTarget.ts'

const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'demo-conveypass'
const firebaseJson = JSON.parse(readFileSync('firebase.json', 'utf8')) as { emulators?: Record<string, { port?: number }> }
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
if (!loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !loopback(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('verify-invite-access: emulator hosts must be loopback addresses (this script never touches a real project)')
  process.exit(1)
}
const [authHost, authPort] = process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':') as [string, string]
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':') as [string, string]

const HASH = 'f'.repeat(64)
const ROLES = ['admin', 'officer', 'supervisor', 'driver', 'security'] as const

initAdmin({ projectId: PROJECT })
const adminDb = getAdminDb()
const adminAuth = getAdminAuth()

const app = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT, authDomain: 'localhost' })
const auth = getAuth(app)
connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true })
setLogLevel('silent') // the SDK logs every denied write; the results below say it better
const db = initializeFirestore(app, {})
connectFirestoreEmulator(db, fsHost, Number(fsPort))

const denied = async (what: string, attempt: () => Promise<unknown>): Promise<boolean> => {
  try {
    await attempt()
  } catch (e) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'permission-denied') return true
    console.error(`  ${what}: failed with ${code || String(e)} (expected permission-denied)`)
    return false
  }
  console.error(`  ${what}: ALLOWED`)
  return false
}

async function main(): Promise<void> {
  await adminDb.doc(`setupInvites/${HASH}`).set({
    createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000), claimedAt: null, claimId: null, usedAt: null, tenantId: null,
  })
  // The raw Admin SDK sees it, so the denials below are about the rules and not about a missing document.
  if (!(await adminDb.doc(`setupInvites/${HASH}`).get()).exists) throw new Error('could not create the test invite')
  console.log('admin SDK: invite readable (as expected: server side only)')

  let failures = 0
  const clients: [string, () => Promise<void>][] = [
    ['signed out', async () => void (await signOut(auth))],
    ...ROLES.map((role): [string, () => Promise<void>] => [
      role,
      async () => {
        const email = `${role}@verify-invites.test`
        const user = await adminAuth.getUserByEmail(email).catch(() => adminAuth.createUser({ email, password: 'Passw0rd!verify' }))
        await adminAuth.setCustomUserClaims(user.uid, { role, tenantId: 'verify', ...(role === 'supervisor' || role === 'driver' ? { contractorId: 'c1' } : {}) })
        await signInWithCustomToken(auth, await adminAuth.createCustomToken(user.uid, { role, tenantId: 'verify' }))
      },
    ]),
  ]
  for (const [name, signIn] of clients) {
    await signIn()
    const results = await Promise.all([
      denied(`${name}: get`, () => getDoc(doc(db, 'setupInvites', HASH))),
      denied(`${name}: list`, () => getDocs(collection(db, 'setupInvites'))),
      denied(`${name}: create`, () => setDoc(doc(db, 'setupInvites', 'e'.repeat(64)), { expiresAt: new Date(), usedAt: null })),
      denied(`${name}: update`, () => updateDoc(doc(db, 'setupInvites', HASH), { usedAt: new Date(), tenantId: 'verify' })),
      denied(`${name}: delete`, () => deleteDoc(doc(db, 'setupInvites', HASH))),
    ])
    const ok = results.every(Boolean)
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: get, list, create, update and delete all denied`)
  }
  const still = (await adminDb.doc(`setupInvites/${HASH}`).get()).data()
  if (still?.usedAt !== null || still?.tenantId !== null) {
    failures++
    console.error('FAIL  the invite was modified by a client')
  }
  await adminDb.doc(`setupInvites/${HASH}`).delete()
  if (failures > 0) {
    console.error(`verify-invite-access: ${failures} role(s) could access setupInvites`)
    process.exit(1)
  }
  console.log('verify-invite-access: no client role can read or write setupInvites')
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error('verify-invite-access failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
