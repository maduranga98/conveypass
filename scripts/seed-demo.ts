/**
 * Demo data for local work. EMULATOR ONLY: it refuses to run unless the Auth and Firestore emulator hosts are
 * loopback addresses, and it never reads production credentials.
 *
 *   npm run emulators            # in one terminal
 *   npm run seed:demo            # in another
 *
 * Creates tenant "demo": 1 admin, 2 contractors (each with a supervisor), 4 drivers and 6 vehicles with assignments,
 * then prints the logins. Re-running needs a clean emulator (the script stops if the tenant already exists).
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
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

const loopback = (hostPort: string): boolean => /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(hostPort)
for (const [name, value] of [
  ['FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST],
  ['FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST],
] as const) {
  if (!value || !loopback(value)) die(`refusing to run: ${name}=${value ?? '(unset)'} is not a local emulator`)
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn('seed:demo: ignoring GOOGLE_APPLICATION_CREDENTIALS (emulator only)')
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? firebaserc.projects?.default ?? 'demo-conveypass'
const TENANT = 'demo'
const PASSWORD = { admin: 'DemoAdmin123', supervisor: 'DemoSuper123' }

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
  { contractor: 'lanka', plate: 'CAB-1234', type: 'Tipper', drivers: [] },
  { contractor: 'ceylon', plate: '250-1234', type: 'Flatbed', makeModel: 'Isuzu FVR', drivers: ['d3', 'd4'] },
  { contractor: 'ceylon', plate: 'SP KB-9087', type: 'Container Carrier', drivers: ['d4'] },
  { contractor: 'ceylon', plate: 'CAD-5566', type: 'Lorry', makeModel: 'Eicher Pro 3015', drivers: [] },
] as const

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
  batch.create(tenantRef, { name: 'ConvoyPass Demo', status: 'active', createdAt: ts })

  const audit = (action: string, targetType: string, targetId: string) =>
    batch.create(db.collection('auditLog').doc(), {
      tenantId: TENANT, action, actorUid: 'seed-demo', actorRole: 'admin', targetType, targetId, meta: {}, createdAt: ts,
    })

  const user = async (p: {
    email: string; password: string; name: string; role: 'admin' | 'supervisor' | 'driver'
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

  for (const s of supervisors) {
    await user({ email: s.email, password: PASSWORD.supervisor, name: s.name, role: 'supervisor', contractorId: cid(s.contractor) })
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

  for (const v of vehicles) {
    const plate = normalisePlate(v.plate) ?? die(`bad demo plate ${v.plate}`)
    const id = newVehicleId()
    batch.create(db.doc(`vehiclePlates/${TENANT}_${plate.plateKey}`), { vehicleId: id })
    batch.create(db.doc(`vehicles/${id}`), {
      tenantId: TENANT, contractorId: cid(v.contractor), plateNo: plate.plateNo, plateKey: plate.plateKey, type: v.type,
      ...('makeModel' in v ? { makeModel: v.makeModel } : {}),
      assignedDriverIds: v.drivers.map((k) => driverIds.get(k) as string),
      status: 'active', createdAt: ts, createdBy: 'seed-demo', updatedAt: ts,
    })
    audit('seed.demo.vehicle', 'vehicle', id)
  }

  await batch.commit()

  console.log('\nseed:demo: done (emulator). Demo logins:\n')
  console.log('  Staff (email / password)')
  console.log(`    admin       admin@demo.convoypass.test            ${PASSWORD.admin}`)
  for (const s of supervisors) {
    const c = contractors.find((x) => x.key === s.contractor)
    console.log(`    supervisor  ${s.email.padEnd(42)}${PASSWORD.supervisor}   (${c?.name})`)
  }
  console.log('\n  Drivers (phone / PIN)')
  for (const d of drivers) {
    const c = contractors.find((x) => x.key === d.contractor)
    console.log(`    ${d.phone}  ${d.pin}   ${d.name} (${c?.name})`)
  }
  console.log('\n  Vehicles:', vehicles.map((v) => v.plate).join(', '), '\n')
}

main().catch((e: unknown) => {
  console.error('seed:demo failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
