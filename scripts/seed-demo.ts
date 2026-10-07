/**
 * Demo data for local work. EMULATOR ONLY: it refuses to run unless the Auth and Firestore emulator hosts are
 * loopback addresses, and it never reads production credentials.
 *
 *   npm run emulators            # in one terminal
 *   npm run seed:demo            # in another
 *
 * Creates tenant "demo" (timezone, pass settings, the default checklist and rejection reasons), 1 admin, 1 officer,
 * 2 contractors (each with a supervisor), 4 drivers and 9 vehicles with assignments, plus passes for today in every
 * state (submitted, supervisor_approved, officer_approved, rejected) across both contractors, some with a "No" answer,
 * and two passes from yesterday that are now expired. Evidence photos are copied from scripts/fixtures/evidence into
 * the Storage emulator, so thumbnails work. Then it prints the logins. Re-running needs a clean emulator (the script
 * stops if the tenant already exists).
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { readFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { dateKey } from '../src/lib/dates.ts'
import { DEFAULT_CHECKLIST, DEFAULT_PASS_SETTINGS } from '../src/lib/defaultChecklist.ts'
import { DEFAULT_REJECTION_REASONS } from '../src/lib/defaultRejectionReasons.ts'
import { normalisePlate } from '../src/lib/plate.ts'

const die = (msg: string): never => {
  console.error(`seed:demo: ${msg}`)
  process.exit(1)
}

const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const firebaseJson = readJson('firebase.json') as { emulators?: Record<string, { port?: number }> }
const firebaserc = readJson('.firebaserc') as { projects?: { default?: string } }

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.storage?.port ?? 9199}`

const loopback = (hostPort: string): boolean => /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(hostPort)
for (const [name, value] of [
  ['FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST],
  ['FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST],
  ['FIREBASE_STORAGE_EMULATOR_HOST', process.env.FIREBASE_STORAGE_EMULATOR_HOST],
] as const) {
  if (!value || !loopback(value)) die(`refusing to run: ${name}=${value ?? '(unset)'} is not a local emulator`)
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn('seed:demo: ignoring GOOGLE_APPLICATION_CREDENTIALS (emulator only)')
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? firebaserc.projects?.default ?? 'demo-conveypass'
const TENANT = 'demo'
const PASSWORD = { admin: 'DemoAdmin123', supervisor: 'DemoSuper123', officer: 'DemoOfficer123' }

/** The bucket the web app uses (VITE_FIREBASE_STORAGE_BUCKET in .env), so the emulator serves it under that name. */
const envFile = (): Record<string, string> => {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => [m[1] as string, m[2] as string]),
    )
  } catch {
    return {}
  }
}

const contractors = [
  { key: 'lanka', name: 'Lanka Cement Haulage', contactName: 'Nimal Perera', phone: '0112345678', address: '12 Galle Road, Colombo 03' },
  { key: 'ceylon', name: 'Ceylon Bulk Transport', contactName: 'Anura Silva', phone: '0812233445', address: '48 Peradeniya Road, Kandy' },
] as const

const supervisors = [
  { contractor: 'lanka', name: 'Kasun Fernando', email: 'supervisor.lanka@demo.convoypass.test' },
  { contractor: 'ceylon', name: 'Dilini Jayasuriya', email: 'supervisor.ceylon@demo.convoypass.test' },
] as const

// PINs are deliberately non-trivial.
const drivers = [
  { key: 'd1', contractor: 'lanka', name: 'Sunil Rathnayake', phone: '0771000001', pin: '482915', licenseNo: 'B1234567' },
  { key: 'd2', contractor: 'lanka', name: 'Ruwan Kumara', phone: '0771000002', pin: '739204' },
  { key: 'd3', contractor: 'ceylon', name: 'Mahesh Bandara', phone: '0771000003', pin: '516283', licenseNo: 'B7654321' },
  { key: 'd4', contractor: 'ceylon', name: 'Chaminda Wickrama', phone: '0771000004', pin: '902817' },
] as const

const vehicles = [
  { contractor: 'lanka', plate: 'WP LJ-4821', type: 'Bulk Tanker', makeModel: 'Tata Prima 4028', drivers: ['d1'] },
  { contractor: 'lanka', plate: 'NP KA 1234', type: 'Cement Bulker', makeModel: 'Ashok Leyland 3718', drivers: ['d1', 'd2'] },
  // No pass today: the vehicle to submit live as driver 0771000001 or 0771000002.
  { contractor: 'lanka', plate: 'CAB-1234', type: 'Tipper', drivers: ['d1', 'd2'] },
  { contractor: 'lanka', plate: 'WP CBA-5521', type: 'Lorry', drivers: ['d2'] },
  { contractor: 'lanka', plate: 'NP LC-3030', type: 'Tipper', drivers: ['d1'] },
  { contractor: 'ceylon', plate: '250-1234', type: 'Flatbed', makeModel: 'Isuzu FVR', drivers: ['d3', 'd4'] },
  { contractor: 'ceylon', plate: 'SP KB-9087', type: 'Container Carrier', drivers: ['d4'] },
  { contractor: 'ceylon', plate: 'CAD-5566', type: 'Lorry', makeModel: 'Eicher Pro 3015', drivers: ['d3'] },
  { contractor: 'ceylon', plate: 'SP CAA-1001', type: 'Flatbed', drivers: ['d4'] },
] as const

type PassState = 'submitted' | 'supervisor_approved' | 'officer_approved' | 'rejected_supervisor' | 'rejected_officer'
interface DemoPass {
  plate: string
  driver: 'd1' | 'd2' | 'd3' | 'd4'
  state: PassState
  /** 0 = today, 1 = yesterday (expired when still waiting). */
  daysAgo: 0 | 1
  /** Checklist ids answered "No". */
  no?: readonly string[]
  /** Minutes ago it was submitted. */
  minutes: number
}
const demoPasses: readonly DemoPass[] = [
  { plate: 'WP LJ-4821', driver: 'd1', state: 'submitted', daysAgo: 0, no: ['dashcam_lens'], minutes: 6 }, // has issues
  { plate: 'WP CBA-5521', driver: 'd2', state: 'submitted', daysAgo: 0, minutes: 12 },
  { plate: 'NP LC-3030', driver: 'd1', state: 'submitted', daysAgo: 0, minutes: 3 },
  { plate: 'NP KA 1234', driver: 'd2', state: 'rejected_supervisor', daysAgo: 0, no: ['dashcam_lens'], minutes: 40 },
  { plate: '250-1234', driver: 'd3', state: 'supervisor_approved', daysAgo: 0, minutes: 25 },
  { plate: 'SP KB-9087', driver: 'd4', state: 'supervisor_approved', daysAgo: 0, no: ['gps_mounted'], minutes: 18 }, // has issues
  { plate: 'CAD-5566', driver: 'd3', state: 'officer_approved', daysAgo: 0, minutes: 55 },
  { plate: 'SP CAA-1001', driver: 'd4', state: 'rejected_officer', daysAgo: 0, minutes: 70 },
  // Yesterday, never decided: shown as Expired, read only.
  { plate: 'WP LJ-4821', driver: 'd1', state: 'submitted', daysAgo: 1, minutes: 60 * 26 },
  { plate: '250-1234', driver: 'd3', state: 'supervisor_approved', daysAgo: 1, minutes: 60 * 27 },
]

const FIXTURES = 'scripts/fixtures/evidence'

// Same shape as functions/src/ids.ts: `veh_` + 10 chars [a-z0-9].
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newVehicleId = (): string => `veh_${Array.from({ length: 10 }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join('')}`

const normalisePhone = (p: string): string => `94${p.slice(1)}`

async function main(): Promise<void> {
  initializeApp({ projectId })
  const auth = getAuth()
  const db = getFirestore()
  const ts = FieldValue.serverTimestamp()

  const tenantRef = db.doc(`tenants/${TENANT}`)
  if ((await tenantRef.get()).exists) die(`tenant "${TENANT}" already exists. Clear the emulator data and run again.`)

  const batch = db.batch()
  const TIMEZONE = 'Asia/Colombo'
  batch.create(tenantRef, {
    name: 'ConvoyPass Demo', status: 'active', createdAt: ts,
    timezone: TIMEZONE, passSettings: DEFAULT_PASS_SETTINGS, checklist: DEFAULT_CHECKLIST, rejectionReasons: DEFAULT_REJECTION_REASONS,
  })

  const audit = (action: string, targetType: string, targetId: string) =>
    batch.create(db.collection('auditLog').doc(), {
      tenantId: TENANT, action, actorUid: 'seed-demo', actorRole: 'admin', targetType, targetId, meta: {}, createdAt: ts,
    })

  const user = async (p: {
    email: string; password: string; name: string; role: 'admin' | 'officer' | 'supervisor' | 'driver'
    contractorId: string | null; phone?: string
  }): Promise<string> => {
    const created = await auth.createUser({ email: p.email, password: p.password, displayName: p.name })
    await auth.setCustomUserClaims(created.uid, {
      role: p.role, tenantId: TENANT, ...(p.contractorId ? { contractorId: p.contractorId } : {}),
    })
    batch.create(db.doc(`users/${created.uid}`), {
      tenantId: TENANT, role: p.role, contractorId: p.contractorId, name: p.name,
      email: p.role === 'driver' ? null : p.email, phone: p.phone ?? null,
      status: 'active', mustChangePassword: false, createdAt: ts, createdBy: 'seed-demo', updatedAt: ts,
    })
    audit('seed.demo.user', 'user', created.uid)
    return created.uid
  }

  await user({ email: 'admin@demo.convoypass.test', password: PASSWORD.admin, name: 'Demo Admin', role: 'admin', contractorId: null })
  const officerUid = await user({ email: 'officer@demo.convoypass.test', password: PASSWORD.officer, name: 'Olivia Officer', role: 'officer', contractorId: null })

  const contractorIds = new Map<string, string>()
  for (const c of contractors) {
    const ref = db.collection('contractors').doc()
    contractorIds.set(c.key, ref.id)
    batch.create(ref, {
      tenantId: TENANT, name: c.name, contactName: c.contactName, phone: c.phone, address: c.address,
      status: 'active', createdAt: ts, createdBy: 'seed-demo', updatedAt: ts,
    })
    audit('seed.demo.contractor', 'contractor', ref.id)
  }
  const cid = (key: string): string => contractorIds.get(key) as string

  const supervisorUids = new Map<string, string>()
  for (const s of supervisors) {
    supervisorUids.set(
      s.contractor,
      await user({ email: s.email, password: PASSWORD.supervisor, name: s.name, role: 'supervisor', contractorId: cid(s.contractor) }),
    )
  }

  const driverIds = new Map<string, string>()
  for (const d of drivers) {
    const phone = normalisePhone(d.phone)
    const uid = await user({
      email: `${phone}@drivers.convoypass.com`, password: d.pin, name: d.name, role: 'driver',
      contractorId: cid(d.contractor), phone,
    })
    driverIds.set(d.key, uid)
    batch.create(db.doc(`drivers/${uid}`), {
      tenantId: TENANT, contractorId: cid(d.contractor), name: d.name, phone,
      ...('licenseNo' in d ? { licenseNo: d.licenseNo } : {}), status: 'active', createdAt: ts, updatedAt: ts,
    })
  }

  const vehicleIds = new Map<string, string>()
  for (const v of vehicles) {
    const plate = normalisePlate(v.plate) ?? die(`bad demo plate ${v.plate}`)
    const id = newVehicleId()
    vehicleIds.set(v.plate, id)
    batch.create(db.doc(`vehiclePlates/${TENANT}_${plate.plateKey}`), { vehicleId: id })
    batch.create(db.doc(`vehicles/${id}`), {
      tenantId: TENANT, contractorId: cid(v.contractor), plateNo: plate.plateNo, plateKey: plate.plateKey, type: v.type,
      ...('makeModel' in v ? { makeModel: v.makeModel } : {}),
      assignedDriverIds: v.drivers.map((k) => driverIds.get(k) as string),
      status: 'active', createdAt: ts, createdBy: 'seed-demo', updatedAt: ts,
    })
    audit('seed.demo.vehicle', 'vehicle', id)
  }

  // ---- passes ----
  const today = dateKey(TIMEZONE)
  const yesterday = dateKey(TIMEZONE, new Date(Date.now() - 24 * 3600_000))
  const at = (minutesAgo: number): Timestamp => Timestamp.fromMillis(Date.now() - minutesAgo * 60_000)
  const people = {
    supervisor: (c: string) => ({ uid: supervisorUids.get(c) as string, name: supervisors.find((x) => x.contractor === c)?.name as string }),
    officer: { uid: officerUid, name: 'Olivia Officer' },
  }
  const uploads: { path: string; file: string }[] = []
  let photoN = 0

  for (const p of demoPasses) {
    const v = vehicles.find((x) => x.plate === p.plate) ?? die(`unknown demo vehicle ${p.plate}`)
    const vehicleId = vehicleIds.get(p.plate) ?? die('demo vehicle missing')
    const plateNo = normalisePlate(p.plate)?.plateNo ?? p.plate
    const day = p.daysAgo === 0 ? today : yesterday
    const driverName = drivers.find((d) => d.key === p.driver)?.name as string
    const sup = people.supervisor(v.contractor)
    const evidenceFile = (kind: 'gps' | 'dashcam') => {
      const file = `${kind}.jpg`
      const path = `tenants/${TENANT}/passes/${vehicleId}/${day}/1/${file}`
      uploads.push({ path, file: `${FIXTURES}/${kind}-${(photoN % 3) + 1}.jpg` })
      return { path, size: 24_000, contentType: 'image/jpeg' }
    }
    photoN++
    const gps = evidenceFile('gps')
    const dashcam = evidenceFile('dashcam')
    const checklist = DEFAULT_CHECKLIST.map((c) =>
      p.no?.includes(c.id) ? { id: c.id, label: c.label, answer: 'no', note: 'Seen loose, will fix tomorrow' } : { id: c.id, label: c.label, answer: 'yes' },
    )
    const submittedAt = at(p.minutes)
    const entry = (action: string, stage: string, by: { uid: string; name: string }, role: string, minutesAgo: number) =>
      ({ action, stage, byUid: by.uid, byName: by.name, byRole: role, at: at(minutesAgo), attempt: 1 })

    const stamps: Record<string, unknown> = {}
    const history: unknown[] = []
    let status = 'submitted'
    if (p.state === 'supervisor_approved' || p.state === 'officer_approved' || p.state === 'rejected_officer') {
      status = 'supervisor_approved'
      stamps.supervisor = { ...sup, at: at(p.minutes - 5) }
      history.push(entry('approve', 'supervisor', sup, 'supervisor', p.minutes - 5))
    }
    if (p.state === 'officer_approved') {
      status = 'officer_approved'
      stamps.officer = { ...people.officer, at: at(p.minutes - 12) }
      history.push(entry('approve', 'officer', people.officer, 'officer', p.minutes - 12))
    }
    if (p.state === 'rejected_supervisor' || p.state === 'rejected_officer') {
      status = 'rejected'
      const byOfficer = p.state === 'rejected_officer'
      const by = byOfficer ? people.officer : sup
      const stage = byOfficer ? 'officer' : 'supervisor'
      const reason = byOfficer ? 'Photo looks old or reused: the GPS photo shows yesterday’s screen' : 'Dashcam photo unclear or not recording: clean the lens and retake both photos'
      stamps.rejection = {
        reason, reasonCode: byOfficer ? 'photo_not_fresh' : 'dashcam_unclear', note: byOfficer ? 'the GPS photo shows yesterday’s screen' : 'clean the lens and retake both photos',
        stage, byUid: by.uid, byName: by.name, byRole: stage, at: at(p.minutes - 15),
      }
      history.push(entry('reject', stage, by, stage, p.minutes - 15))
    }
    batch.create(db.doc(`passes/${vehicleId}_${day}`), {
      tenantId: TENANT, contractorId: cid(v.contractor), vehicleId, plateNo, vehicleType: v.type, dateKey: day,
      driverId: driverIds.get(p.driver) as string, driverName, status, attempt: 1, submittedAt, updatedAt: ts,
      checklist, evidence: { gps, dashcam, extra: [] },
      captureMeta: { method: 'file', clientCapturedAt: { gps: new Date().toISOString(), dashcam: new Date().toISOString() } },
      ...stamps, history,
    })
  }

  await batch.commit()

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? envFile().VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`
  const bucket = getStorage().bucket(bucketName)
  for (const u of uploads) await bucket.file(u.path).save(readFileSync(u.file), { contentType: 'image/jpeg', resumable: false })

  console.log('\nseed:demo: done (emulator). Demo logins:\n')
  console.log('  Staff (email / password)')
  console.log(`    admin       admin@demo.convoypass.test            ${PASSWORD.admin}`)
  console.log(`    officer     officer@demo.convoypass.test          ${PASSWORD.officer}`)
  for (const s of supervisors) {
    const c = contractors.find((x) => x.key === s.contractor)
    console.log(`    supervisor  ${s.email.padEnd(42)}${PASSWORD.supervisor}   (${c?.name})`)
  }
  console.log('\n  Drivers (phone / PIN)')
  for (const d of drivers) {
    const c = contractors.find((x) => x.key === d.contractor)
    console.log(`    ${d.phone}  ${d.pin}   ${d.name} (${c?.name})`)
  }
  console.log('\n  Passes for today (and what to try):')
  const label: Record<PassState, string> = {
    submitted: 'submitted (waiting for the supervisor)',
    supervisor_approved: 'supervisor approved (waiting for the officer)',
    officer_approved: 'officer approved',
    rejected_supervisor: 'rejected by the supervisor (driver can fix and resubmit)',
    rejected_officer: 'rejected by the officer (driver can fix and resubmit)',
  }
  for (const p of demoPasses) {
    const c = contractors.find((x) => x.key === vehicles.find((v) => v.plate === p.plate)?.contractor)
    console.log(`    ${p.daysAgo === 0 ? 'today    ' : 'yesterday'}  ${p.plate.padEnd(12)} ${label[p.state]}${p.no ? '  [has a "No" answer]' : ''}${p.daysAgo ? '  [expired]' : ''}  (${c?.name}, ${drivers.find((d) => d.key === p.driver)?.name})`)
  }
  const live = vehicleIds.get('CAB-1234') as string
  console.log(`\n  Live demo: sign in as driver 0771000001 (PIN 482915), open /v/${live} (CAB-1234, no pass yet) and submit.`)
  console.log('  Then as supervisor.lanka@... it appears under Approvals; approve it, and the officer sees it under "Awaiting me".')
  console.log('\n  Vehicle ids:', [...vehicleIds].map(([p, id]) => `${p} -> /v/${id}`).join('\n               '), '\n')
}

main().catch((e: unknown) => {
  console.error('seed:demo failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
