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
