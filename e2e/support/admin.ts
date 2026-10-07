// Admin SDK helper: runs in its own process (`tsx e2e/support/admin.ts <command> <json>`), because Playwright's module
// loader cannot load firebase-admin. Emulators only.
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { CONTRACTOR, DRIVER_AUTH_EMAIL, PASSWORD, PIN, PLATE, PROJECT, STAFF, TENANT, VEHICLE } from './constants.ts'

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199'

if (!getApps().length) initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
const db = getFirestore()
const auth = getAuth()

const clearEmulators = async (): Promise<void> => {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

const uids: Record<string, string> = {}

async function user(key: string, email: string, password: string, name: string, claims: Record<string, string>, doc: Record<string, unknown>): Promise<void> {
  const u = await auth.createUser({ email, password, displayName: name })
  await auth.setCustomUserClaims(u.uid, claims)
  await db.doc(`users/${u.uid}`).set({
    tenantId: TENANT, contractorId: null, name, email: null, phone: null, status: 'active', mustChangePassword: false,
    createdAt: FieldValue.serverTimestamp(), createdBy: 'e2e', updatedAt: FieldValue.serverTimestamp(), ...doc,
  })
  uids[key] = u.uid
}

/** A clean tenant with one of every role, one contractor, one vehicle assigned to the driver. */
async function seed(): Promise<Record<string, string>> {
  await clearEmulators()
  await db.doc(`tenants/${TENANT}`).set({ name: 'E2E Quarry', status: 'active', timezone: 'Asia/Colombo', createdAt: FieldValue.serverTimestamp() })
  await db.doc(`contractors/${CONTRACTOR}`).set({ tenantId: TENANT, name: 'Acme Haulage', status: 'active', createdAt: Timestamp.now(), createdBy: 'e2e', updatedAt: Timestamp.now() })
  for (const [role, who] of Object.entries(STAFF)) {
    const contractorId = role === 'supervisor' ? CONTRACTOR : null
    await user(role, who.email, PASSWORD, who.name, { role, tenantId: TENANT, ...(contractorId ? { contractorId } : {}) }, { role, email: who.email, contractorId })
  }
  await user('driver', DRIVER_AUTH_EMAIL, PIN, 'Dan Driver', { role: 'driver', tenantId: TENANT, contractorId: CONTRACTOR }, { role: 'driver', contractorId: CONTRACTOR, phone: '94771234567' })
  await db.doc(`drivers/${uids.driver}`).set({ tenantId: TENANT, contractorId: CONTRACTOR, name: 'Dan Driver', phone: '94771234567', status: 'active', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  await db.doc(`vehicles/${VEHICLE}`).set({
    tenantId: TENANT, contractorId: CONTRACTOR, plateNo: PLATE, plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: [uids.driver], status: 'active',
    createdAt: Timestamp.now(), createdBy: 'e2e', updatedAt: Timestamp.now(),
  })
  await db.doc(`vehiclePlates/${TENANT}_WPLJ4821`).set({ vehicleId: VEHICLE })
  return uids
}

/** Today's `YYYYMMDD` in the tenant timezone. */
const todayKey = (): string => {
  const p = new Intl.DateTimeFormat('en-US-u-nu-latn', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}${g('month')}${g('day')}`
}

/** What `submitPass` would leave behind: the real Firestore trigger then notifies the contractor's supervisors. */
async function writeSubmittedPass(over: Record<string, unknown> = {}, vehicleId = VEHICLE, plateNo = PLATE, driverId = ''): Promise<string> {
  const id = `${vehicleId}_${todayKey()}`
  await db.doc(`passes/${id}`).set({
    tenantId: TENANT, contractorId: CONTRACTOR, vehicleId, plateNo, vehicleType: 'Tipper', dateKey: todayKey(), driverId: driverId, driverName: 'Dan Driver',
    status: 'submitted', attempt: 1, submittedAt: Timestamp.now(), updatedAt: Timestamp.now(),
    checklist: [{ id: 'tyres', label: 'Tyres are in good condition', answer: 'yes' }],
    evidence: { gps: { path: 'p/gps.jpg', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'p/dashcam.jpg', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
    ...over,
  })
  return id
}

const notificationsFor = async (uid: string): Promise<{ id: string; read: boolean }[]> =>
  (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d) => ({ id: d.id, read: (d.data() as { readAt: unknown }).readAt !== null }))

const [command, raw] = process.argv.slice(2)
const args = JSON.parse(raw ?? '{}') as Record<string, string>
const run = async (): Promise<unknown> => {
  switch (command) {
    case 'seed':
      return seed()
    case 'writeSubmittedPass':
      return writeSubmittedPass({}, args.vehicleId, args.plateNo, args.driverId)
    case 'notificationsFor':
      return notificationsFor(args.uid ?? '')
    default:
      throw new Error(`unknown command ${String(command)}`)
  }
}
run().then(
  (result) => {
    console.log(`RESULT ${JSON.stringify(result)}`)
    process.exit(0)
  },
  (e: unknown) => {
    console.error(e)
    process.exit(1)
  },
)
