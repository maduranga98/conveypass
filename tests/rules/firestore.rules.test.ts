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
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

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

  it('admin can suspend but not change tenant, and cannot delete', async () => {
    const db = adminA()
    await assertSucceeds(
      updateDoc(doc(db, 'contractors', 'c1'), { status: 'suspended', updatedAt: serverTimestamp() }),
    )
    await assertFails(
      updateDoc(doc(db, 'contractors', 'c1'), { tenantId: B, updatedAt: serverTimestamp() }),
    )
    await assertFails(
      updateDoc(doc(db, 'contractors', 'c1'), { status: 'deleted', updatedAt: serverTimestamp() }),
    )
    await assertFails(deleteDoc(doc(db, 'contractors', 'c1')))
  })
})

describe('default deny', () => {
  it('denies unknown collections', async () => {
    await assertFails(getDoc(doc(adminA(), 'secrets', 'x')))
    await assertFails(setDoc(doc(adminA(), 'vehicles', 'x'), { tenantId: A }))
  })
})
