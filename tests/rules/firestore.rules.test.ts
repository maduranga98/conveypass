import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const A = 'tenantA'
const B = 'tenantB'

let env: RulesTestEnvironment

const userDoc = (over: Record<string, unknown>) => ({
  tenantId: A,
  role: 'driver',
  contractorId: 'c1',
  name: 'N',
  email: null,
  phone: '94771234567',
  status: 'active',
  mustChangePassword: false,
  ...over,
})

const contractorDoc = (tenantId: string, name: string) => ({
  tenantId,
  name,
  status: 'active',
  createdAt: new Date(),
  createdBy: 'seed',
  updatedAt: new Date(),
})

const vehicleDoc = (tenantId: string, contractorId: string, assignedDriverIds: string[]) => ({
  tenantId,
  contractorId,
  plateNo: 'CAB-1234',
  plateKey: 'CAB1234',
  type: 'Tipper',
  assignedDriverIds,
  status: 'active',
  createdAt: new Date(),
  createdBy: 'seed',
  updatedAt: new Date(),
})

const driverProfile = (tenantId: string, contractorId: string) => ({
  tenantId,
  contractorId,
  name: 'D',
  phone: '94771234567',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-conveypass-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'tenants', A), { name: 'A', status: 'active' })
    await setDoc(doc(db, 'tenants', B), { name: 'B', status: 'active' })
    await setDoc(doc(db, 'users', 'adminA'), userDoc({ role: 'admin', contractorId: null }))
    await setDoc(doc(db, 'users', 'adminB'), userDoc({ tenantId: B, role: 'admin', contractorId: null }))
    await setDoc(doc(db, 'users', 'supA1'), userDoc({ role: 'supervisor', contractorId: 'c1' }))
    await setDoc(doc(db, 'users', 'drvA1'), userDoc({ contractorId: 'c1' }))
    await setDoc(doc(db, 'users', 'drvA1b'), userDoc({ contractorId: 'c1', phone: '94770000001' }))
    await setDoc(doc(db, 'users', 'drvA2'), userDoc({ contractorId: 'c2', phone: '94770000002' }))
    await setDoc(doc(db, 'users', 'drvB1'), userDoc({ tenantId: B, contractorId: 'cB' }))
    await setDoc(doc(db, 'contractors', 'c1'), contractorDoc(A, 'C1'))
    await setDoc(doc(db, 'contractors', 'c2'), contractorDoc(A, 'C2'))
    await setDoc(doc(db, 'contractors', 'cB'), contractorDoc(B, 'CB'))
    await setDoc(doc(db, 'vehicles', 'veh_a1'), vehicleDoc(A, 'c1', ['drvA1']))
    await setDoc(doc(db, 'vehicles', 'veh_a2'), vehicleDoc(A, 'c1', ['drvA1', 'drvA1b']))
    await setDoc(doc(db, 'vehicles', 'veh_a3'), vehicleDoc(A, 'c1', []))
    await setDoc(doc(db, 'vehicles', 'veh_a4'), vehicleDoc(A, 'c2', ['drvA2']))
    await setDoc(doc(db, 'vehicles', 'veh_b1'), vehicleDoc(B, 'cB', ['drvB1']))
    await setDoc(doc(db, 'drivers', 'drvA1'), driverProfile(A, 'c1'))
    await setDoc(doc(db, 'drivers', 'drvA1b'), driverProfile(A, 'c1'))
    await setDoc(doc(db, 'drivers', 'drvA2'), driverProfile(A, 'c2'))
    await setDoc(doc(db, 'drivers', 'drvB1'), driverProfile(B, 'cB'))
    await setDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`), { vehicleId: 'veh_a1' })
    for (const [id, tenantId, contractorId, driverId] of [
      ['veh_a1_20260310', A, 'c1', 'drvA1'],
      ['veh_a2_20260310', A, 'c1', 'drvA1b'],
      ['veh_a4_20260310', A, 'c2', 'drvA2'],
      ['veh_b1_20260310', B, 'cB', 'drvB1'],
    ] as const) {
      await setDoc(doc(db, 'passes', id), { tenantId, contractorId, driverId, status: 'submitted', attempt: 1 })
    }
    await setDoc(doc(db, 'auditLog', 'a1'), { tenantId: A, action: 'user.create' })
    await setDoc(doc(db, 'auditLog', 'b1'), { tenantId: B, action: 'user.create' })
  })
})

const as = (uid: string, claims: Record<string, unknown>) =>
  env.authenticatedContext(uid, claims).firestore()

const adminA = () => as('adminA', { role: 'admin', tenantId: A })
const supA1 = () => as('supA1', { role: 'supervisor', tenantId: A, contractorId: 'c1' })
const drvA1 = () => as('drvA1', { role: 'driver', tenantId: A, contractorId: 'c1' })
const officerA = () => as('offA', { role: 'officer', tenantId: A })
const securityA = () => as('secA', { role: 'security', tenantId: A })

describe('unauthenticated', () => {
  it('cannot read anything', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users', 'drvA1')))
    await assertFails(getDoc(doc(db, 'tenants', A)))
    await assertFails(getDoc(doc(db, 'contractors', 'c1')))
  })
})

describe('tenant isolation', () => {
  it('denies cross-tenant reads for every collection', async () => {
    const db = adminA()
    await assertFails(getDoc(doc(db, 'users', 'adminB')))
    await assertFails(getDoc(doc(db, 'users', 'drvB1')))
    await assertFails(getDoc(doc(db, 'tenants', B)))
    await assertFails(getDoc(doc(db, 'contractors', 'cB')))
    await assertFails(getDoc(doc(db, 'auditLog', 'b1')))
  })

  it('denies a cross-tenant users query', async () => {
    await assertFails(getDocs(query(collection(adminA(), 'users'), where('tenantId', '==', B))))
  })

  it('allows a tenant-scoped users query for admin', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(adminA(), 'users'), where('tenantId', '==', A))),
    )
    if (snap.size !== 5) throw new Error(`expected 5 tenant users, got ${snap.size}`)
  })

  it('denies an unscoped users query', async () => {
    await assertFails(getDocs(collection(adminA(), 'users')))
  })

  it('denies users whose token lacks claims', async () => {
    const db = env.authenticatedContext('nobody', {}).firestore()
    await assertFails(getDoc(doc(db, 'tenants', A)))
    await assertFails(getDoc(doc(db, 'contractors', 'c1')))
  })

  it('cannot create contractors in another tenant', async () => {
    const db = adminA()
    await assertFails(
      setDoc(doc(db, 'contractors', 'x'), {
        tenantId: B,
        name: 'X',
        status: 'active',
        createdAt: serverTimestamp(),
        createdBy: 'adminA',
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot update a contractor in another tenant', async () => {
    await assertFails(
      updateDoc(doc(adminA(), 'contractors', 'cB'), { name: 'Hacked', updatedAt: serverTimestamp() }),
    )
  })
})

describe('tenants', () => {
  it('members read their own tenant only; nobody writes', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'tenants', A)))
    await assertFails(getDoc(doc(drvA1(), 'tenants', B)))
    await assertFails(updateDoc(doc(adminA(), 'tenants', A), { name: 'x' }))
    await assertFails(setDoc(doc(adminA(), 'tenants', 'new'), { name: 'x' }))
    await assertFails(deleteDoc(doc(adminA(), 'tenants', A)))
  })
})

describe('users', () => {
  it('user reads own doc', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'users', 'drvA1')))
  })

  it('driver cannot read other users', async () => {
    await assertFails(getDoc(doc(drvA1(), 'users', 'drvA1b')))
    await assertFails(getDoc(doc(drvA1(), 'users', 'adminA')))
    await assertFails(getDoc(doc(drvA1(), 'users', 'supA1')))
  })

  it('admin reads any user in tenant', async () => {
    await assertSucceeds(getDoc(doc(adminA(), 'users', 'drvA2')))
    await assertSucceeds(getDoc(doc(adminA(), 'users', 'supA1')))
  })

  it('supervisor sees only drivers of own contractor', async () => {
    const db = supA1()
    await assertSucceeds(getDoc(doc(db, 'users', 'drvA1b')))
    await assertFails(getDoc(doc(db, 'users', 'drvA2')))
    await assertFails(getDoc(doc(db, 'users', 'adminA')))
    await assertFails(getDoc(doc(db, 'users', 'drvB1')))
    await assertSucceeds(getDoc(doc(db, 'users', 'supA1')))
  })

  it('supervisor query is limited to own-contractor drivers', async () => {
    const q = (cid: string) =>
      query(
        collection(supA1(), 'users'),
        where('tenantId', '==', A),
        where('role', '==', 'driver'),
        where('contractorId', '==', cid),
      )
    const own = await assertSucceeds(getDocs(q('c1')))
    if (own.size !== 2) throw new Error(`expected 2 drivers, got ${own.size}`)
    await assertFails(getDocs(q('c2')))
  })

  it('officer and security cannot read other users', async () => {
    await assertFails(getDoc(doc(officerA(), 'users', 'drvA1')))
    await assertFails(getDoc(doc(securityA(), 'users', 'drvA1')))
  })

  it('denies every client write, including own doc and by admin', async () => {
    for (const db of [adminA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'users', 'newUser'), userDoc({})))
      await assertFails(updateDoc(doc(db, 'users', 'drvA1'), { name: 'Hacked' }))
      await assertFails(deleteDoc(doc(db, 'users', 'drvA1')))
    }
    await assertFails(updateDoc(doc(drvA1(), 'users', 'drvA1'), { role: 'admin' }))
    await assertFails(updateDoc(doc(drvA1(), 'users', 'drvA1'), { mustChangePassword: false }))
  })
})

describe('auditLog', () => {
  it('admin reads own tenant audit log only', async () => {
    await assertSucceeds(getDoc(doc(adminA(), 'auditLog', 'a1')))
    await assertFails(getDoc(doc(adminA(), 'auditLog', 'b1')))
  })

  it('non-admins cannot read', async () => {
    for (const db of [supA1(), drvA1(), officerA(), securityA()]) {
      await assertFails(getDoc(doc(db, 'auditLog', 'a1')))
    }
  })

  it('denies all client writes', async () => {
    const entry = { tenantId: A, action: 'x' }
    await assertFails(addDoc(collection(adminA(), 'auditLog'), entry))
    await assertFails(updateDoc(doc(adminA(), 'auditLog', 'a1'), { action: 'y' }))
    await assertFails(deleteDoc(doc(adminA(), 'auditLog', 'a1')))
  })
})

describe('contractors', () => {
  const newContractor = (over: Record<string, unknown> = {}) => ({
    tenantId: A,
    name: 'New Co',
    status: 'active',
    createdAt: serverTimestamp(),
    createdBy: 'adminA',
    updatedAt: serverTimestamp(),
    ...over,
  })

  it('reads: admin/officer/security all in tenant; supervisor/driver own only', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c1')))
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c2')))
    }
    for (const db of [supA1(), drvA1()]) {
      await assertSucceeds(getDoc(doc(db, 'contractors', 'c1')))
      await assertFails(getDoc(doc(db, 'contractors', 'c2')))
    }
  })

  it('officer, security, supervisor and driver cannot write', async () => {
    for (const db of [officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'contractors', 'z'), newContractor()))
      await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: 'x', updatedAt: serverTimestamp() }))
    }
  })

  it('admin creates a valid contractor', async () => {
    await assertSucceeds(setDoc(doc(adminA(), 'contractors', 'new'), newContractor({ phone: '0771234567' })))
  })

  it('rejects invalid contractor payloads', async () => {
    const db = adminA()
    await assertFails(setDoc(doc(db, 'contractors', 'n1'), newContractor({ name: '' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n2'), newContractor({ status: 'suspended' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n3'), newContractor({ createdBy: 'someoneElse' })))
    await assertFails(setDoc(doc(db, 'contractors', 'n4'), newContractor({ extra: 1 })))
    await assertFails(setDoc(doc(db, 'contractors', 'n5'), newContractor({ createdAt: new Date() })))
  })

  it('admin edits descriptive fields, including address and notes', async () => {
    const db = adminA()
    await assertSucceeds(
      updateDoc(doc(db, 'contractors', 'c1'), {
        name: 'Renamed',
        contactName: 'Kamal',
        phone: '0771234567',
        address: '1 Main St',
        notes: 'Cement hauler',
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { address: 'x'.repeat(201), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { notes: 'x'.repeat(1001), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: '', updatedAt: serverTimestamp() }))
  })

  it('admin cannot change status (function-only): suspend, activate or anything else', async () => {
    const db = adminA()
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'suspended', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'suspended', name: 'Also renamed', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { status: 'deleted', updatedAt: serverTimestamp() }))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'contractors', 'c2'), { status: 'suspended' })
    })
    await assertFails(updateDoc(doc(db, 'contractors', 'c2'), { status: 'active', updatedAt: serverTimestamp() }))
  })

  it('admin cannot change tenant or audit fields, and cannot delete', async () => {
    const db = adminA()
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { tenantId: B, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { createdBy: 'adminA', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'contractors', 'c1'), { name: 'x' })) // updatedAt must be the server time
    await assertFails(deleteDoc(doc(db, 'contractors', 'c1')))
  })
})

describe('vehicles', () => {
  const ids = async (db: ReturnType<typeof adminA>, ...constraints: ReturnType<typeof where>[]) =>
    (await assertSucceeds(getDocs(query(collection(db, 'vehicles'), ...constraints)))).docs.map((d) => d.id).sort()

  it('admin, officer and security read every vehicle of their tenant', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      expect(await ids(db, where('tenantId', '==', A))).toEqual(['veh_a1', 'veh_a2', 'veh_a3', 'veh_a4'])
      await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a4')))
    }
  })

  it('supervisor reads only their own contractor’s vehicles', async () => {
    const db = supA1()
    expect(await ids(db, where('tenantId', '==', A), where('contractorId', '==', 'c1'))).toEqual(['veh_a1', 'veh_a2', 'veh_a3'])
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a1')))
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a4')))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('contractorId', '==', 'c2'))))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A)))) // would include c2
  })

  it('driver reads only the vehicles they are assigned to', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a1')))
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a2')))
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a3'))) // same contractor, not assigned
    await assertFails(getDoc(doc(db, 'vehicles', 'veh_a4')))
    expect(await ids(db, where('tenantId', '==', A), where('assignedDriverIds', 'array-contains', 'drvA1'))).toEqual(['veh_a1', 'veh_a2'])
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))))
    await assertFails(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('assignedDriverIds', 'array-contains', 'drvA1b'))))
  })

  it('denies cross-tenant reads and queries', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'vehicles', 'veh_b1')))
    }
    await assertFails(getDocs(query(collection(adminA(), 'vehicles'), where('tenantId', '==', B))))
    await assertFails(getDoc(doc(as('adminB', { role: 'admin', tenantId: B }), 'vehicles', 'veh_a1')))
  })

  it('denies reads without claims and when signed out', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'vehicles', 'veh_a1')))
    await assertFails(getDoc(doc(env.authenticatedContext('x', {}).firestore(), 'vehicles', 'veh_a1')))
  })

  it('denies every client write to vehicles, by every role', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'vehicles', 'veh_new'), vehicleDoc(A, 'c1', [])))
      await assertFails(addDoc(collection(db, 'vehicles'), vehicleDoc(A, 'c1', [])))
      await assertFails(updateDoc(doc(db, 'vehicles', 'veh_a1'), { status: 'suspended' }))
      await assertFails(updateDoc(doc(db, 'vehicles', 'veh_a1'), { assignedDriverIds: ['drvA1', 'drvA1b'] }))
      await assertFails(deleteDoc(doc(db, 'vehicles', 'veh_a1')))
    }
  })
})

describe('drivers', () => {
  it('admin, officer and security read every driver profile of their tenant', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      const snap = await assertSucceeds(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
      expect(snap.docs.map((d) => d.id).sort()).toEqual(['drvA1', 'drvA1b', 'drvA2'])
    }
  })

  it('supervisor reads only their own contractor’s drivers', async () => {
    const db = supA1()
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))),
    )
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['drvA1', 'drvA1b'])
    await assertFails(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertFails(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
  })

  it('a driver reads only their own profile', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'drivers', 'drvA1')))
    await assertFails(getDoc(doc(db, 'drivers', 'drvA1b'))) // same contractor
    await assertFails(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertFails(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A))))
  })

  it('denies cross-tenant reads', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'drivers', 'drvB1')))
    }
    await assertFails(getDocs(query(collection(adminA(), 'drivers'), where('tenantId', '==', B))))
  })

  it('denies every client write to drivers, including a driver editing themselves', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'drivers', 'drvNew'), driverProfile(A, 'c1')))
      await assertFails(updateDoc(doc(db, 'drivers', 'drvA1'), { name: 'Hacked' }))
      await assertFails(updateDoc(doc(db, 'drivers', 'drvA1'), { photoPath: 'tenants/x/y.jpg' }))
      await assertFails(deleteDoc(doc(db, 'drivers', 'drvA1')))
    }
  })
})

describe('vehiclePlates', () => {
  it('has no client access at all', async () => {
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`)))
      await assertFails(getDocs(collection(db, 'vehiclePlates')))
      await assertFails(setDoc(doc(db, 'vehiclePlates', `${A}_NEW`), { vehicleId: 'veh_a1' }))
      await assertFails(updateDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`), { vehicleId: 'veh_a2' }))
      await assertFails(deleteDoc(doc(db, 'vehiclePlates', `${A}_WPLJ4821`)))
    }
  })
})

describe('default deny', () => {
  it('denies unknown collections', async () => {
    await assertFails(getDoc(doc(adminA(), 'secrets', 'x')))
    await assertFails(setDoc(doc(adminA(), 'invoices', 'x'), { tenantId: A }))
  })
})

describe('passes', () => {
  it('a driver reads only their own passes (get and query)', async () => {
    const db = drvA1()
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a1_20260310')))
    await assertFails(getDoc(doc(db, 'passes', 'veh_a2_20260310'))) // another driver's pass on a shared vehicle
    await assertFails(getDoc(doc(db, 'passes', 'veh_a4_20260310')))
    const own = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('driverId', '==', 'drvA1'))))
    expect(own.size).toBe(1)
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
  })
  it('a supervisor reads only their contractor’s passes', async () => {
    const db = supA1()
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a1_20260310')))
    await assertSucceeds(getDoc(doc(db, 'passes', 'veh_a2_20260310')))
    await assertFails(getDoc(doc(db, 'passes', 'veh_a4_20260310')))
    const mine = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('contractorId', '==', 'c1'))))
    expect(mine.size).toBe(2)
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
  })
  it('admin, officer and security read the whole tenant, never another tenant', async () => {
    for (const db of [adminA(), officerA(), securityA()]) {
      const all = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A))))
      expect(all.size).toBe(3)
      await assertFails(getDoc(doc(db, 'passes', 'veh_b1_20260310')))
    }
    await assertFails(getDoc(doc(drvA1(), 'passes', 'veh_b1_20260310')))
  })
  it('signed-out users read nothing', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'passes', 'veh_a1_20260310')))
  })
  it('nobody writes passes from the client, whatever the role or status asked for', async () => {
    const fresh = { tenantId: A, contractorId: 'c1', driverId: 'drvA1', status: 'submitted', attempt: 1 }
    for (const db of [adminA(), supA1(), drvA1(), officerA(), securityA()]) {
      await assertFails(setDoc(doc(db, 'passes', 'veh_a3_20260310'), fresh))
      await assertFails(addDoc(collection(db, 'passes'), fresh))
      await assertFails(updateDoc(doc(db, 'passes', 'veh_a1_20260310'), { status: 'officer_approved' }))
      await assertFails(deleteDoc(doc(db, 'passes', 'veh_a1_20260310')))
    }
  })
  it('tenants stay read-only for members', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'tenants', A)))
    await assertFails(updateDoc(doc(adminA(), 'tenants', A), { checklist: [] }))
    await assertFails(updateDoc(doc(drvA1(), 'tenants', A), { passSettings: { requireLocation: true } }))
  })
})

describe('passes: approval queues (Module 4)', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, driverId: string, status: string, over: Record<string, unknown> = {}) => ({
        tenantId, contractorId, driverId, status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
        checklist: [{ id: 'x', label: 'X', answer: 'yes' }], ...over,
      })
      await setDoc(doc(db, 'passes', 'q1'), pass(A, 'c1', 'drvA1', 'submitted'))
      await setDoc(doc(db, 'passes', 'q2'), pass(A, 'c1', 'drvA1b', 'supervisor_approved', { supervisor: { uid: 'supA1', name: 'S' } }))
      await setDoc(doc(db, 'passes', 'q3'), pass(A, 'c2', 'drvA2', 'submitted'))
      await setDoc(doc(db, 'passes', 'q4'), pass(A, 'c2', 'drvA2', 'supervisor_approved', { dateKey: '20260309' }))
      await setDoc(doc(db, 'passes', 'q5'), pass(B, 'cB', 'drvB1', 'submitted'))
    })
  })
  const dayQuery = (db: ReturnType<typeof adminA>, ...extra: ReturnType<typeof where>[]) =>
    getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), ...extra))

  it('a supervisor’s live queue only works scoped to their contractor, and never shows another contractor', async () => {
    const db = supA1()
    const mine = await assertSucceeds(dayQuery(db, where('contractorId', '==', 'c1'), where('status', 'in', ['submitted', 'supervisor_approved']), where('dateKey', '==', DAY)))
    expect(mine.docs.map((d) => d.id).sort()).toEqual(['q1', 'q2'])
    await assertFails(dayQuery(db, where('contractorId', '==', 'c2'), where('status', '==', 'submitted')))
    await assertFails(dayQuery(db, where('status', '==', 'submitted'))) // not scoped to the contractor
    await assertFails(getDoc(doc(db, 'passes', 'q3')))
  })
  it('an officer’s queue (status + day, and the expired range) reads across contractors in the tenant only', async () => {
    const db = officerA()
    const awaiting = await assertSucceeds(dayQuery(db, where('status', '==', 'supervisor_approved'), where('dateKey', '==', DAY)))
    expect(awaiting.docs.map((d) => d.id)).toEqual(['q2'])
    const expired = await assertSucceeds(dayQuery(db, where('status', 'in', ['submitted', 'supervisor_approved']), where('dateKey', '<', DAY)))
    expect(expired.docs.map((d) => d.id)).toEqual(['q4'])
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B))))
    await assertFails(getDoc(doc(db, 'passes', 'q5')))
  })
  it('admin reads the day list for the tenant, not another tenant’s', async () => {
    const day = await assertSucceeds(dayQuery(adminA(), where('dateKey', '==', DAY)))
    expect(day.size).toBe(3)
    await assertFails(getDoc(doc(adminA(), 'passes', 'q5')))
  })
  it('a driver reads only their own, and not through a tenant-wide or contractor-wide query', async () => {
    await assertSucceeds(getDoc(doc(drvA1(), 'passes', 'q1')))
    await assertFails(getDoc(doc(drvA1(), 'passes', 'q2')))
    await assertFails(dayQuery(drvA1(), where('contractorId', '==', 'c1')))
  })
  it('no role can write any decision field, create a history entry or delete (all of it is function-only)', async () => {
    const decisions = [
      { status: 'supervisor_approved' },
      { status: 'officer_approved', officer: { uid: 'x', name: 'X' } },
      { status: 'rejected', rejection: { reason: 'r', reasonCode: 'other', stage: 'officer' } },
      { history: [] },
      { supervisor: { uid: 'x', name: 'X' } },
    ]
    for (const db of [adminA(), supA1(), drvA1(), officerA(), securityA()]) {
      for (const patch of decisions) await assertFails(updateDoc(doc(db, 'passes', 'q1'), patch))
      await assertFails(deleteDoc(doc(db, 'passes', 'q1')))
    }
  })
  it('members read rejectionReasons from their tenant document but cannot change it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants', A), { name: 'A', status: 'active', rejectionReasons: [{ id: 'other', label: 'Other' }] })
    })
    for (const db of [adminA(), supA1(), officerA(), drvA1()]) {
      const snap = await assertSucceeds(getDoc(doc(db, 'tenants', A)))
      expect(snap.data()?.rejectionReasons).toEqual([{ id: 'other', label: 'Other' }])
      await assertFails(updateDoc(doc(db, 'tenants', A), { rejectionReasons: [] }))
    }
  })
})

describe('the gate (Module 5)', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, driverId: string, status: string) => ({
        tenantId, contractorId, driverId, status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
      })
      await setDoc(doc(db, 'passes', 'g1'), pass(A, 'c1', 'drvA1', 'officer_approved'))
      await setDoc(doc(db, 'passes', 'g2'), pass(A, 'c2', 'drvA2', 'checked_in'))
      await setDoc(doc(db, 'passes', 'g3'), pass(A, 'c1', 'drvA1b', 'submitted'))
      await setDoc(doc(db, 'passes', 'gB'), pass(B, 'cB', 'drvB1', 'officer_approved'))
      const event = (tenantId: string) => ({
        tenantId, type: 'denied', vehicleId: 'veh_a1', plateNo: 'CAB-1234', contractorId: 'c1', passId: null, passStatus: null,
        reasonCode: 'not_approved', gateId: 'main', gateName: 'Main Gate', byUid: 'secA', byName: 'S', at: new Date(), requestId: 'r',
      })
      await setDoc(doc(db, 'gateEvents', 'den_a'), event(A))
      await setDoc(doc(db, 'gateEvents', 'den_b'), event(B))
      await setDoc(doc(db, 'tenants', A), { name: 'A', status: 'active', gates: [{ id: 'main', name: 'Main Gate' }] })
    })
  })

  it('security reads the tenant’s vehicles, drivers and contractors (get and the gate home queries)', async () => {
    const db = securityA()
    await assertSucceeds(getDoc(doc(db, 'vehicles', 'veh_a4')))
    const vehicles = await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), orderBy('plateKey'), limit(1000))))
    expect(vehicles.size).toBe(4)
    await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), where('plateKey', '>=', 'CAB'), where('plateKey', '<', 'CAB\uf8ff'), orderBy('plateKey'), limit(8))))
    await assertSucceeds(getDoc(doc(db, 'drivers', 'drvA2')))
    await assertSucceeds(getDoc(doc(db, 'contractors', 'c2')))
    await assertSucceeds(getDocs(query(collection(db, 'contractors'), where('tenantId', '==', A), orderBy('createdAt', 'desc'))))
  })
  it('security reads today’s approved and checked-in passes across contractors, and a single pass', async () => {
    const db = securityA()
    const live = await assertSucceeds(
      getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY), where('status', 'in', ['officer_approved', 'checked_in']), limit(300))),
    )
    expect(live.docs.map((d) => d.id).sort()).toEqual(['g1', 'g2'])
    await assertSucceeds(getDoc(doc(db, 'passes', 'g3')))
  })
  it('security is denied cross-tenant reads and unscoped queries', async () => {
    const db = securityA()
    for (const [col, id] of [['passes', 'gB'], ['vehicles', 'veh_b1'], ['drivers', 'drvB1'], ['contractors', 'cB'], ['tenants', B]] as const) {
      await assertFails(getDoc(doc(db, col, id)))
    }
    await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B))))
    await assertFails(getDocs(collection(db, 'vehicles')))
  })
  it('members read the gates from their tenant document but nobody writes it', async () => {
    for (const db of [securityA(), adminA(), officerA(), supA1()]) {
      const snap = await assertSucceeds(getDoc(doc(db, 'tenants', A)))
      expect(snap.data()?.gates).toEqual([{ id: 'main', name: 'Main Gate' }])
      await assertFails(updateDoc(doc(db, 'tenants', A), { gates: [] }))
    }
  })
  it('gateEvents: admin and officer read their tenant’s log only', async () => {
    for (const db of [adminA(), officerA()]) {
      await assertSucceeds(getDoc(doc(db, 'gateEvents', 'den_a')))
      const log = await assertSucceeds(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A), where('at', '>=', new Date(0)), orderBy('at', 'desc'))))
      expect(log.docs.map((d) => d.id)).toEqual(['den_a'])
      await assertFails(getDoc(doc(db, 'gateEvents', 'den_b')))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', B))))
    }
  })
  it('gateEvents: security, supervisors and drivers have no access', async () => {
    for (const db of [securityA(), supA1(), drvA1()]) {
      await assertFails(getDoc(doc(db, 'gateEvents', 'den_a')))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A))))
    }
  })
  it('gateEvents are never written from the client, by any role', async () => {
    const event = { tenantId: A, type: 'denied', vehicleId: 'veh_a1', reasonCode: 'other', byUid: 'secA', at: serverTimestamp() }
    for (const db of [adminA(), officerA(), securityA(), supA1(), drvA1()]) {
      await assertFails(setDoc(doc(db, 'gateEvents', 'den_x'), event))
      await assertFails(addDoc(collection(db, 'gateEvents'), event))
      await assertFails(updateDoc(doc(db, 'gateEvents', 'den_a'), { note: 'changed' }))
      await assertFails(deleteDoc(doc(db, 'gateEvents', 'den_a')))
    }
  })
  it('no client can check a pass in: status, checkIn block and history stay function-only', async () => {
    const patches = [
      { status: 'checked_in' },
      { checkIn: { uid: 'secA', name: 'S', gateId: 'main', requestId: 'r' } },
      { status: 'checked_in', checkIn: { uid: 'secA' }, history: [{ action: 'check_in' }] },
    ]
    for (const db of [securityA(), adminA(), officerA(), supA1(), drvA1()]) {
      for (const patch of patches) await assertFails(updateDoc(doc(db, 'passes', 'g1'), patch))
      await assertFails(setDoc(doc(db, 'passes', 'g1'), { tenantId: A, status: 'checked_in' }))
    }
  })
})

describe('dashboard and reports (Module 6): nothing new, nothing loosened', () => {
  const DAY = '20260310'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const pass = (tenantId: string, contractorId: string, status: string) => ({
        tenantId, contractorId, driverId: 'drvA1', status, attempt: 1, dateKey: DAY, submittedAt: new Date(),
      })
      await setDoc(doc(db, 'passes', 'm1'), pass(A, 'c1', 'submitted'))
      await setDoc(doc(db, 'passes', 'm2'), pass(A, 'c2', 'checked_in'))
      await setDoc(doc(db, 'passes', 'mB'), pass(B, 'cB', 'submitted'))
      await setDoc(doc(db, 'gateEvents', 'den_a'), {
        tenantId: A, type: 'denied', vehicleId: 'veh_a1', plateNo: 'CAB-1234', contractorId: 'c1', reasonCode: 'other', gateId: 'main',
        gateName: 'Main Gate', byUid: 'secA', byName: 'S', at: new Date(), requestId: 'r',
      })
    })
  })

  it('admin and officer read today’s tenant passes (the live dashboard query) and never another tenant’s', async () => {
    for (const db of [adminA(), officerA()]) {
      const today = await assertSucceeds(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY), limit(1000))))
      expect(today.docs.map((d) => d.id).sort()).toEqual(['m1', 'm2'])
      await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', B), where('dateKey', '==', DAY))))
      await assertFails(getDoc(doc(db, 'passes', 'mB')))
    }
  })
  it('admin and officer read the tenant’s gate events, vehicles, drivers and contractors', async () => {
    for (const db of [adminA(), officerA()]) {
      const events = await assertSucceeds(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A), where('at', '>=', new Date(0)), orderBy('at', 'desc'), limit(15))))
      expect(events.size).toBe(1)
      await assertSucceeds(getDocs(query(collection(db, 'vehicles'), where('tenantId', '==', A), orderBy('plateKey'), limit(1000))))
      await assertSucceeds(getDocs(query(collection(db, 'drivers'), where('tenantId', '==', A), limit(1000))))
      await assertSucceeds(getDocs(query(collection(db, 'contractors'), where('tenantId', '==', A))))
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', B))))
    }
  })
  it('supervisor, driver and security cannot read the tenant-wide passes or the gate events a dashboard needs', async () => {
    for (const db of [supA1(), drvA1(), securityA()]) {
      await assertFails(getDocs(query(collection(db, 'gateEvents'), where('tenantId', '==', A))))
    }
    for (const db of [supA1(), drvA1()]) {
      await assertFails(getDocs(query(collection(db, 'passes'), where('tenantId', '==', A), where('dateKey', '==', DAY))))
    }
  })
})
